import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlFile, OParlMeeting } from '../oparl/types.js';
import { upsertBody, upsertMeeting, upsertOrganization, upsertSource, type SourceRecord, type SyncStats } from '../sync/sync.js';
import { berlinIso } from './sessionnet.js';

/**
 * Gemeinden ohne Ratsinformationssystem, die ihre öffentlichen Sitzungsunterlagen je Gremium auf der Website ablegen
 * (IONAS-Website, z. B. Gemeinde Budenheim: Übersichtsseite „Sitzungsunterlagen“, darunter eine Seite je Gremium mit den
 * Abschnitten „Einladungen“, „Beschlussvorlagen“, „Niederschriften“ …). Je Gremium und Tag eine Sitzung; das Datum steht im
 * Dateinamen („GR_20260826 - Einladung.pdf“). Ohne Uhrzeit und ohne Tagesordnungspunkte, die PDFs werden nur verlinkt.
 * Die Quell-URL ist die Übersichtsseite.
 */

export interface IonasDatei {
  name: string;
  url: string;
  abschnitt: string;
  datum: string; // JJJJ-MM-TT
}

export interface IonasGremium {
  name: string;
  dateien: IonasDatei[];
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&uuml;/g, 'ü').replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö').replace(/&szlig;/g, 'ß').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/** Links zu den Gremienseiten unterhalb der Übersichtsseite (genau eine Ebene tiefer). */
export function gremienSeiten(html: string, uebersicht: string): string[] {
  const basis = new URL(uebersicht);
  const pfad = basis.pathname.replace(/\/?$/, '/');
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#?]+)"/gi)) {
    if (/\{\{|%7B/i.test(m[1]!)) continue; // Vorlagenplatzhalter der Seite („{{ item.uri }}“)
    let u: URL;
    try { u = new URL(m[1]!.replace(/&amp;/g, '&'), basis); } catch { continue; }
    if (u.origin !== basis.origin || !u.pathname.startsWith(pfad)) continue;
    const rest = u.pathname.slice(pfad.length).replace(/\/$/, '');
    if (rest && !rest.includes('/') && !/\.[a-z0-9]{2,4}$/i.test(rest)) out.add(`${basis.origin}${pfad}${rest}/`);
  }
  return [...out];
}

/** Datum aus Dateiname („GR_20260826 - Einladung.pdf“) oder Linktext („… 2024-09-11 …“). */
export function dateiDatum(url: string, titel: string): string | null {
  let name = url;
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { /* unverändert */ }
  const kompakt = /(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?![0-9])/.exec(name);
  if (kompakt) return `${kompakt[1]}-${kompakt[2]}-${kompakt[3]}`;
  const iso = /(20\d{2})-(\d{2})-(\d{2})/.exec(`${name} ${titel}`);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function parseGremium(html: string, seite: string): IonasGremium {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const name = h1 ? text(h1[1]!) : '';
  const dateien: IonasDatei[] = [];
  const gesehen = new Set<string>();
  let abschnitt = '';
  for (const m of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>|<a\b[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (m[1] !== undefined) { abschnitt = text(m[1]); continue; }
    const url = new URL(m[2]!.replace(/&amp;/g, '&'), seite).href;
    const titel = text(m[3]!);
    const datum = dateiDatum(url, titel);
    if (!datum || gesehen.has(url)) continue;
    gesehen.add(url);
    let dateiname = url;
    try { dateiname = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.pdf$/i, ''); } catch { /* unverändert */ }
    dateien.push({ name: dateiname, url, abschnitt, datum });
  }
  return { name, dateien };
}

const rolle = (abschnitt: string): 'invitation' | 'verbatimProtocol' | 'auxiliary' =>
  /einladung/i.test(abschnitt) ? 'invitation' : /nieder|protokoll/i.test(abschnitt) ? 'verbatimProtocol' : 'auxiliary';

export async function syncIonas(
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
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('Sitzungsunterlagen der Website', source.id);
  const basis = new URL(source.url).origin + '/';
  const bodyId = `${basis}#koerperschaft`;
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: source.name, shortName: source.id, web: source.url } as never));
  stats.bodies = 1;

  const seiten = gremienSeiten(await client.getText(source.url), source.url);
  log(`  Gremienseiten: ${seiten.length}`);
  for (const seite of seiten) {
    let g: IonasGremium;
    try {
      g = parseGremium(await client.getText(seite), seite);
    } catch (err) {
      log(`  ${seite}: ${(err as Error).message} (übersprungen)`); // Verweis ohne Gremienseite (Navigation, entfernte Seite)
      continue;
    }
    if (!g.name || !g.dateien.length) continue;
    const orgId = `${basis}#gremium-${encodeURIComponent(g.name)}`;
    tx(db, () => upsertOrganization(db, bodyId, { id: orgId, name: g.name, organizationType: 'Gremium' } as never));
    stats.organizations++;
    const nachTag = new Map<string, IonasDatei[]>();
    for (const d of g.dateien) {
      if (d.datum < ab) continue;
      nachTag.set(d.datum, [...(nachTag.get(d.datum) ?? []), d]);
    }
    for (const [datum, dateien] of nachTag) {
      const datei = (d: IonasDatei): OParlFile => ({ id: d.url, name: d.name, accessUrl: d.url, mimeType: 'application/pdf' } as OParlFile);
      const einl = dateien.filter((d) => rolle(d.abschnitt) === 'invitation');
      const nied = dateien.filter((d) => rolle(d.abschnitt) === 'verbatimProtocol');
      const rest = [...einl.slice(1), ...nied.slice(1), ...dateien.filter((d) => rolle(d.abschnitt) === 'auxiliary')];
      const meeting = {
        id: `${orgId}#sitzung-${datum}`,
        name: g.name,
        meetingState: datum >= heute ? 'eingeladen' : 'durchgeführt',
        start: berlinIso(datum, '00:00'),
        organization: [orgId],
        agendaItem: [],
        invitation: einl[0] ? datei(einl[0]) : undefined,
        verbatimProtocol: nied[0] ? datei(nied[0]) : undefined,
        auxiliaryFile: rest.map(datei),
        web: seite,
        quelle: 'ionas',
      } as unknown as OParlMeeting;
      tx(db, () => upsertMeeting(db, bodyId, meeting, stats));
      stats.meetings++;
    }
  }
  log(`  Sitzungen: ${stats.meetings}`);
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
