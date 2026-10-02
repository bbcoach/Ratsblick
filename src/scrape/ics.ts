import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlMeeting } from '../oparl/types.js';
import { upsertBody, upsertMeeting, upsertOrganization, upsertSource, type SourceRecord, type SyncStats } from '../sync/sync.js';
import { berlinIso } from './sessionnet.js';

/**
 * Nur Termine aus einem Kalenderexport (iCalendar), für Systeme, deren Seiten nicht abrufbar sind, deren
 * Kalenderexport aber ausdrücklich erlaubt ist – z. B. SD.NET RIM auf `*.ratsinfomanagement.net`
 * (robots.txt: „Disallow: /“, „Allow: /termine/ics/“; Seiten hinter einer Browser-Prüfung).
 * Sitzungen ohne Tagesordnung; der Link zur Tagesordnung aus DESCRIPTION wird als Dokument geführt.
 */

export interface IcsTermin {
  uid: string;
  titel: string;
  start: string; // ISO mit Versatz
  ende: string | null;
  ort: string | null;
  link: string | null;
}

const entschluesseln = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

/** Zeitpunkt aus DTSTART/DTEND (lokal mit TZID Europe/Berlin oder UTC mit Z). */
function zeitpunkt(wert: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(wert.trim());
  if (!m) return null;
  if (m[7]) return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
  return berlinIso(`${m[1]}-${m[2]}-${m[3]}`, m[4] ? `${m[4]}:${m[5]}` : '00:00');
}

/** Ort ohne leere und doppelte Teile („in Klärung, , in Klärung“ → „in Klärung“). */
function ort(wert: string | undefined): string | null {
  if (!wert) return null;
  const teile = [...new Set(entschluesseln(wert).split(/\s*,\s*/).filter(Boolean))];
  return teile.join(', ') || null;
}

export function parseIcs(ics: string): IcsTermin[] {
  // Gefaltete Zeilen (Fortsetzung beginnt mit Leerzeichen oder Tab) zusammenfügen
  const zeilen = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: IcsTermin[] = [];
  let e: Record<string, string> | null = null;
  for (const z of zeilen) {
    if (z === 'BEGIN:VEVENT') e = {};
    else if (z === 'END:VEVENT' && e) {
      const start = e.DTSTART ? zeitpunkt(e.DTSTART) : null;
      if (e.UID && start) {
        const beschreibung = entschluesseln(e.DESCRIPTION ?? '');
        out.push({
          uid: e.UID,
          titel: entschluesseln(e.SUMMARY ?? 'Sitzung'),
          start,
          ende: e.DTEND ? zeitpunkt(e.DTEND) : null,
          ort: ort(e.LOCATION),
          link: /https?:\/\/\S+/.exec(beschreibung)?.[0] ?? null,
        });
      }
      e = null;
    } else if (e) {
      const i = z.indexOf(':');
      if (i > 0) e[z.slice(0, i).split(';')[0]!] = z.slice(i + 1);
    }
  }
  return out;
}

export async function syncIcs(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: { log?: (msg: string) => void; now?: Date } = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };
  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('Kalenderexport (iCalendar)', source.id);
  const basis = new URL(source.url).origin + '/';
  const bodyId = `${basis}#koerperschaft`;
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: source.name.replace(/^VG /, 'Verbandsgemeinde '), shortName: source.id } as never));
  stats.bodies = 1;

  const termine = parseIcs(await client.getText(source.url));
  log(`  Kalender: ${termine.length} Termine`);
  const gremien = new Set<string>();
  for (const t of termine) {
    const orgId = `${basis}#gremium-${encodeURIComponent(t.titel)}`;
    if (!gremien.has(orgId)) {
      gremien.add(orgId);
      tx(db, () => upsertOrganization(db, bodyId, { id: orgId, name: t.titel, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }
    const meeting = {
      id: `${basis}termine#${t.uid}`,
      name: t.titel,
      meetingState: t.start < jetzt.toISOString() ? 'durchgeführt' : 'terminiert',
      start: t.start,
      end: t.ende ?? undefined,
      location: t.ort ? { description: t.ort } : undefined,
      organization: [orgId],
      agendaItem: [],
      auxiliaryFile: t.link
        ? [{ id: t.link, name: 'Tagesordnung im Ratsinformationssystem', accessUrl: t.link, mimeType: 'text/html' }]
        : [],
      quelle: 'ics',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, bodyId, meeting, stats));
    stats.meetings++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
