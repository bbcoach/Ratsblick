import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlFile, OParlMeeting } from '../oparl/types.js';
import { upsertBody, upsertMeeting, upsertOrganization, upsertSource, type SourceRecord, type SyncStats } from '../sync/sync.js';
import { berlinIso } from './sessionnet.js';

/**
 * Ortsgemeinden ohne Ratsinformationssystem, deren Website Einladungen und Niederschriften als Linkliste führt
 * (WordPress, Joomla, Jimdo, IONAS …, jede Seite anders). Gemeinsame Heuristik: ein Link, in dessen Text oder Adresse ein Datum
 * und eines der Stichwörter Niederschrift/Protokoll/Einladung/Tagesordnung/Sitzung vorkommt, ist ein Dokument zu dieser Sitzung.
 * Je Datum eine Sitzung des Ortsgemeinderats (`gremium` der Quelle), ohne Uhrzeit und ohne Tagesordnungspunkte; Seiten in `seiten`
 * (die Quell-URL ist die erste). Es wird nur verlinkt, nichts heruntergeladen.
 */

export interface OrtsDokument {
  datum: string; // JJJJ-MM-TT
  art: 'niederschrift' | 'einladung' | 'sonstiges';
  name: string;
  url: string;
}

const MONATE: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&uuml;/g, 'ü')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&szlig;/g, 'ß').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();

const iso = (j: string, m: string | number, t: string | number) => `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
const plausibel = (d: string) => {
  if (d < '2015-01-01' || d > '2035-12-31') return false;
  const [j, m, t] = d.split('-').map(Number) as [number, number, number];
  const x = new Date(Date.UTC(j, m - 1, t));
  return x.getUTCFullYear() === j && x.getUTCMonth() === m - 1 && x.getUTCDate() === t; // 31.02. ist kein Datum
};

/** Datum aus „27.08.2026“, „27-08-2026“, „13. Mai 2026“, „20260827“ oder „2026-08-27“; zweistellige Jahre („19.01.23“) nur mit Punkten. */
export function ortsDatum(s: string): string | null {
  let m = /(?<![0-9])(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})(?![0-9])/.exec(s) ?? /(?<![0-9])(\d{1,2})[-_](\d{1,2})[-_](20\d{2})(?![0-9])/.exec(s);
  if (m) return plausibel(iso(m[3]!, m[2]!, m[1]!)) ? iso(m[3]!, m[2]!, m[1]!) : null;
  m = /(?<![0-9])(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(20\d{2})(?![0-9])/.exec(s);
  if (m && MONATE[m[2]!.toLowerCase()]) return plausibel(iso(m[3]!, MONATE[m[2]!.toLowerCase()]!, m[1]!)) ? iso(m[3]!, MONATE[m[2]!.toLowerCase()]!, m[1]!) : null;
  m = /(?<![0-9])(20\d{2})[-_](\d{2})[-_](\d{2})(?![0-9])/.exec(s) ?? /(?<![0-9])(20\d{2})(\d{2})(\d{2})(?![0-9])/.exec(s);
  if (m && plausibel(iso(m[1]!, m[2]!, m[3]!))) return iso(m[1]!, m[2]!, m[3]!);
  m = /(?<![0-9])(\d{1,2})\.(\d{1,2})\.(\d{2})(?![0-9])/.exec(s);
  if (m) return plausibel(iso('20' + m[3]!, m[2]!, m[1]!)) ? iso('20' + m[3]!, m[2]!, m[1]!) : null;
  return null;
}

export function parseOrtsseite(html: string, basis: string): OrtsDokument[] {
  const out = new Map<string, { d: OrtsDokument; ausText: boolean }>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1]!.replace(/&amp;/g, '&'), basis).href; } catch { continue; }
    if (!/^https?:/.test(url)) continue;
    const t = text(m[2]!);
    let slug = url;
    try { slug = decodeURIComponent(new URL(url).pathname + new URL(url).search); } catch { /* unverändert */ }
    const alles = `${t} ${slug}`;
    if (!/niederschrift|protokoll|einladung|tagesordnung|sitzung/i.test(alles)) continue;
    const dText = ortsDatum(t);
    const datum = dText ?? ortsDatum(slug);
    if (!datum) continue;
    // Derselbe Link mehrfach (Bild-, Titel-, „Mehr“-Link): das Datum aus dem sichtbaren Text gilt vor dem aus der Adresse
    if (out.get(url)?.ausText || (out.has(url) && !dText)) continue;
    // Beschriftungsloser Link oder „Herunterladen“: Art aus der Adresse
    const art = /niederschrift|protokoll/i.test(alles) ? 'niederschrift' : /einladung|tagesordnung/i.test(alles) ? 'einladung' : 'sonstiges';
    const name = !t || /^(herunterladen|download|mehr|mehr lesen|…)$/i.test(t) ? slug.split('/').filter(Boolean).pop()!.replace(/\.[a-z0-9]+$/i, '') : t;
    out.set(url, { d: { datum, art, name: name.slice(0, 120), url }, ausText: !!dText });
  }
  return [...out.values()].map((x) => x.d);
}

export async function syncOrtsseiten(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: { log?: (msg: string) => void; now?: Date } = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const jetzt = opts.now ?? new Date();
  const ab = new Date(jetzt.getTime() - 2 * 365 * 864e5).toISOString().slice(0, 10); // zwei Jahre
  const heute = jetzt.toISOString().slice(0, 10);
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };
  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('Website der Ortsgemeinde', source.id);
  const basis = new URL(source.url).origin + '/';
  const bodyId = `${basis}#koerperschaft`;
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: source.name, shortName: source.id, web: source.url } as never));
  stats.bodies = 1;

  const seiten = [source.url, ...(source.seiten ?? [])];
  const alle: OrtsDokument[] = [];
  for (const s of seiten) {
    try { alle.push(...parseOrtsseite(await client.getText(s), s)); } catch (err) { log(`  ${s}: ${(err as Error).message} (übersprungen)`); }
  }
  log(`  Dokumente: ${alle.length} auf ${seiten.length} Seite(n)`);

  const gremium = source.gremium ?? 'Ortsgemeinderat';
  const orgId = `${basis}#gremium-${encodeURIComponent(gremium)}`;
  tx(db, () => upsertOrganization(db, bodyId, { id: orgId, name: gremium, organizationType: 'Gremium' } as never));
  stats.organizations = 1;
  const nachTag = new Map<string, OrtsDokument[]>();
  for (const d of alle) if (d.datum >= ab) nachTag.set(d.datum, [...(nachTag.get(d.datum) ?? []), d]);
  const datei = (d: OrtsDokument): OParlFile => ({ id: d.url, name: d.name, accessUrl: d.url, mimeType: /\.pdf(\?|$)/i.test(d.url) ? 'application/pdf' : 'text/html' } as OParlFile);
  for (const [datum, dokumente] of nachTag) {
    const nied = dokumente.filter((d) => d.art === 'niederschrift');
    const einl = dokumente.filter((d) => d.art === 'einladung');
    const rest = [...nied.slice(1), ...einl.slice(1), ...dokumente.filter((d) => d.art === 'sonstiges')];
    const meeting = {
      id: `${orgId}#sitzung-${datum}`,
      name: gremium,
      meetingState: datum >= heute ? 'eingeladen' : 'durchgeführt',
      start: berlinIso(datum, '00:00'),
      organization: [orgId],
      agendaItem: [],
      invitation: einl[0] ? datei(einl[0]) : undefined,
      verbatimProtocol: nied[0] ? datei(nied[0]) : undefined,
      auxiliaryFile: rest.map(datei),
      web: source.url,
      quelle: 'ortsseiten',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, bodyId, meeting, stats));
    stats.meetings++;
  }
  log(`  Sitzungen: ${stats.meetings}`);
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
