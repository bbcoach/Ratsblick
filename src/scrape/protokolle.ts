import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlMeeting } from '../oparl/types.js';
import { upsertBody, upsertMeeting, upsertOrganization, upsertSource, type SourceRecord, type SyncStats } from '../sync/sync.js';
import { berlinIso } from './sessionnet.js';

/**
 * Städte und Gemeinden ohne Ratsinformationssystem, die ihre Sitzungsprotokolle als PDF-Liste auf der Website veröffentlichen
 * (z. B. Stadt Kusel: „Sitzung des Stadtrates der Stadt Kusel vom 23.04.2026 (PDF)“). Je Eintrag eine abgeschlossene Sitzung
 * mit dem Protokoll als Dokument; ohne Uhrzeit und ohne Tagesordnungspunkte. Die Listenseiten stehen in `seiten`
 * (Quell-URL = erste Seite). Die PDFs werden nur verlinkt, nicht abgerufen.
 */

export interface Protokoll {
  gremium: string;
  datum: string; // JJJJ-MM-TT
  url: string;
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&uuml;/g, 'ü').replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö').replace(/&szlig;/g, 'ß').replace(/\s+/g, ' ').trim();

/** „Stadtrates“ → „Stadtrat“, „Haupt-, Bau und Finanzausschusses“ → „Haupt-, Bau und Finanzausschuss“. */
export function gremiumName(genitiv: string): string {
  return genitiv.trim().replace(/ausschusses$/i, 'ausschuss').replace(/rates$/i, 'rat');
}

export function parseProtokolle(html: string, basis: string, standardGremium = 'Gemeinderat'): Protokoll[] {
  const out: Protokoll[] = [];
  // Ortsgemeinden mit einfacher Liste („Niederschrift vom 27.08.2026“, Link auch auf eine Downloadseite statt direkt auf das PDF)
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const k = /^Niederschrift(?:en)?\s+vom\s+(\d{2})\.(\d{2})\.(\d{4})\b/i.exec(text(m[2]!));
    if (k) out.push({ gremium: standardGremium, datum: `${k[3]}-${k[2]}-${k[1]}`, url: new URL(m[1]!.replace(/&amp;/g, '&'), basis).href });
  }
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = text(m[2]!);
    // „Sitzung des Stadtrates der Stadt Kusel vom 23.04.2026 (PDF)“, auch „Sitzungsniederschrift des … Ausschusses der Stadt …“
    const k = /^Sitzung(?:sniederschrift|sprotokoll)?\s+des\s+(.+?)\s+der\s+\S+\s+\S+\s+vom\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(t);
    if (!k) continue;
    out.push({ gremium: gremiumName(k[1]!), datum: `${k[4]}-${k[3]}-${k[2]}`, url: new URL(m[1]!.replace(/&amp;/g, '&'), basis).href });
  }
  return out;
}

export async function syncProtokolle(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: { log?: (msg: string) => void; now?: Date } = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const jetzt = opts.now ?? new Date();
  const ab = new Date(jetzt.getTime() - 2 * 365 * 864e5).toISOString().slice(0, 10); // zwei Jahre
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };
  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('Protokollliste der Website', source.id);
  const basis = new URL(source.url).origin + '/';
  const bodyId = `${basis}#koerperschaft`;
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: source.name, shortName: source.id, web: source.url } as never));
  stats.bodies = 1;

  const seiten = [source.url, ...(source.seiten ?? [])];
  const alle: Protokoll[] = [];
  for (const s of seiten) alle.push(...parseProtokolle(await client.getText(s), s, source.gremium));
  log(`  Protokolle: ${alle.length} auf ${seiten.length} Seite(n)`);

  const gremien = new Set<string>();
  const nummer = new Map<string, number>();
  for (const p of alle) {
    if (p.datum < ab) continue;
    const orgId = `${basis}#gremium-${encodeURIComponent(p.gremium)}`;
    if (!gremien.has(orgId)) {
      gremien.add(orgId);
      tx(db, () => upsertOrganization(db, bodyId, { id: orgId, name: p.gremium, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }
    // Zwei Protokolle desselben Gremiums am selben Tag: der Reihe nach nummerieren
    const key = `${orgId}|${p.datum}`;
    const n = (nummer.get(key) ?? 0) + 1;
    nummer.set(key, n);
    const meeting = {
      id: `${orgId}#sitzung-${p.datum}-${n}`,
      name: p.gremium,
      meetingState: 'durchgeführt',
      start: berlinIso(p.datum, '00:00'),
      organization: [orgId],
      agendaItem: [],
      verbatimProtocol: { id: p.url, name: `Protokoll ${p.datum.split('-').reverse().join('.')}`, accessUrl: p.url, mimeType: /\.pdf(\?|$)/i.test(p.url) ? 'application/pdf' : 'text/html' }, // Downloadseite statt PDF: „WEB“
      web: source.url,
      quelle: 'protokolle',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, bodyId, meeting, stats));
    stats.meetings++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
