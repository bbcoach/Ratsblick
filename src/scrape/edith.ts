import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlMeeting } from '../oparl/types.js';
import { upsertBody, upsertMeeting, upsertOrganization, upsertSource, type SourceRecord, type SyncStats } from '../sync/sync.js';
import { berlinIso } from './sessionnet.js';

/**
 * Politik-Modul „edith“ der NetzWerkstatt (`<name>.regio-data.de/edith-….php`, in die Gemeinde-Website eingebettet),
 * z. B. VG Thalfang am Erbeskopf. Kein Ratsinformationssystem: je Gremium eine Auswahlliste mit Sitzungseinladungen und
 * eine mit Unterrichtungen (Niederschriften), jeweils nur Datum → PDF. Sitzungen daher ohne Uhrzeit und ohne TOPs,
 * mit Einladung (enthält die Tagesordnung) und Niederschrift als Dokument.
 * Ortsgemeinden haben je eine eigene Seite; gefunden über die Ortsgemeinden-Seite der Website (`mandanten: true`).
 */

export interface EdithGremium {
  name: string;
  einladungen: Array<{ datum: string; url: string }>;
  niederschriften: Array<{ datum: string; url: string }>;
}

export interface EdithSeite {
  /** Körperschaft aus der Überschrift („Ortsgemeinderat der Ortsgemeinde Berglicht“ → „Ortsgemeinde Berglicht“). */
  koerperschaft: string | null;
  gremien: EdithGremium[];
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&uuml;/g, 'ü').replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö')
    .replace(/&szlig;/g, 'ß').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function optionen(select: string | undefined, basis: string): Array<{ datum: string; url: string }> {
  if (!select) return [];
  const out: Array<{ datum: string; url: string }> = [];
  for (const m of select.matchAll(/<option[^>]*value="([^"]+)"[^>]*>\s*(\d{2})\.(\d{2})\.(\d{4})/g)) {
    out.push({ datum: `${m[4]}-${m[3]}-${m[2]}`, url: new URL(m[1]!, basis).href });
  }
  return out;
}

export function parseEdith(html: string, basis: string): EdithSeite {
  const kopf = /<thead>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>/.exec(html);
  const ueberschrift = kopf ? text(kopf[1]!) : '';
  const k = /^\S*rat(?:es)? de[rs] (.+)$/.exec(ueberschrift);
  const gremien: EdithGremium[] = [];
  for (const tabelle of html.matchAll(/<table class="politik"[\s\S]*?<\/table>/g)) {
    for (const zeile of tabelle[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const zellen = [...zeile[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((z) => z[1]!);
      if (zellen.length < 2) continue;
      const name = text(zellen[0]!);
      const einl = /<select[^>]*name="berichte"[\s\S]*?<\/select>/.exec(zeile[1]!)?.[0];
      const nied = /<select[^>]*name="niederschrift"[\s\S]*?<\/select>/.exec(zeile[1]!)?.[0];
      if (!name || (!einl && !nied)) continue;
      gremien.push({ name, einladungen: optionen(einl, basis), niederschriften: optionen(nied, basis) });
    }
  }
  return { koerperschaft: k ? k[1]!.trim() : null, gremien };
}

/** Adresse der eingebetteten edith-Seite aus einer Seite der Gemeinde-Website. */
export function edithAdresse(html: string): string | null {
  return /<iframe[^>]*src="(https:\/\/[^"]*regio-data\.de\/edith-[^"]+)"/.exec(html)?.[1] ?? null;
}

/** Politik-Seiten der Ortsgemeinden aus der Ortsgemeinden-Übersicht („…/ortsgemeinden/berglicht.html“ → „…/berglicht/politik.html“). */
export function ortsgemeindeSeiten(html: string, basis: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="((?:de\/)?verwaltung-politik\/ortsgemeinden\/[a-z0-9-]+)\.html"/g)) {
    out.add(new URL(`${m[1]!.replace(/^de\//, '')}/politik.html`, basis).href.replace(/\/verwaltung-politik\//, '/de/verwaltung-politik/'));
  }
  return [...out];
}

export async function syncEdith(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: { log?: (msg: string) => void; now?: Date } = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const jetzt = opts.now ?? new Date();
  // Sitzungen der letzten 12 Monate und alle künftigen (die Listen reichen bis 2014 zurück)
  const ab = new Date(jetzt.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };
  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('edith (NetzWerkstatt)', source.id);
  const website = new URL(source.url).origin + '/';

  const seiten: Array<{ seite: string; standard: boolean }> = [{ seite: source.url, standard: true }];
  if (source.mandanten) {
    const og = await client.getText(new URL('verwaltung-politik/ortsgemeinden.html', website).href);
    for (const s of ortsgemeindeSeiten(og, website)) seiten.push({ seite: s, standard: false });
  }
  log(`  Seiten: ${seiten.length}`);

  for (const { seite, standard } of seiten) {
    const edith = edithAdresse(await client.getText(seite));
    if (!edith) { log(`  ohne Politik-Modul: ${seite}`); continue; }
    const p = parseEdith(await client.getText(edith), edith);
    const name = p.koerperschaft ?? (standard ? source.name.replace(/^VG /, 'Verbandsgemeinde ') : null);
    if (!name) { log(`  ohne Körperschaft: ${edith}`); continue; }
    const bodyId = standard ? `${website}#koerperschaft` : `${edith}#koerperschaft`;
    tx(db, () => upsertBody(db, source.id, { id: bodyId, name, shortName: name, web: seite } as never));
    stats.bodies++;
    for (const g of p.gremien) {
      const orgId = `${edith}#gremium-${encodeURIComponent(g.name)}`;
      // Gremium mit Ort, damit gleichnamige Ausschüsse verschiedener Gemeinden unterscheidbar bleiben
      const gremium = /rat$/i.test(g.name) && !g.name.includes(' ') ? `${g.name} ${name.replace(/^(Ortsgemeinde|Verbandsgemeinde|Stadt) /, '')}` : g.name;
      tx(db, () => upsertOrganization(db, bodyId, { id: orgId, name: gremium, organizationType: 'Gremium' } as never));
      stats.organizations++;
      // Einladung und Niederschrift zum selben Datum gehören zur selben Sitzung (bei zwei Sitzungen am Tag der Reihe nach)
      const sitzungen = new Map<string, { datum: string; einladung?: string; niederschrift?: string }>();
      const zaehle = (liste: Array<{ datum: string; url: string }>, rolle: 'einladung' | 'niederschrift') => {
        const n = new Map<string, number>();
        for (const e of liste) {
          const i = (n.get(e.datum) ?? 0) + 1;
          n.set(e.datum, i);
          const key = `${e.datum}-${i}`;
          const s = sitzungen.get(key) ?? { datum: e.datum };
          s[rolle] = e.url;
          sitzungen.set(key, s);
        }
      };
      zaehle(g.einladungen, 'einladung');
      zaehle(g.niederschriften, 'niederschrift');
      for (const [key, s] of sitzungen) {
        if (s.datum < ab) continue;
        const start = berlinIso(s.datum, '00:00');
        const datei = (url: string, titel: string) => ({ id: url, name: `${titel} ${s.datum.split('-').reverse().join('.')}`, accessUrl: url, mimeType: 'application/pdf' });
        const meeting = {
          id: `${orgId}#sitzung-${key}`,
          name: gremium,
          meetingState: s.niederschrift || start < jetzt.toISOString() ? 'durchgeführt' : 'eingeladen',
          start,
          organization: [orgId],
          agendaItem: [],
          invitation: s.einladung ? datei(s.einladung, 'Einladung') : undefined,
          verbatimProtocol: s.niederschrift ? datei(s.niederschrift, 'Unterrichtung') : undefined,
          web: edith,
          quelle: 'edith',
        } as unknown as OParlMeeting;
        tx(db, () => upsertMeeting(db, bodyId, meeting, stats));
        stats.meetings++;
      }
    }
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
