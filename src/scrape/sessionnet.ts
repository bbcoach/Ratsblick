import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type { OParlFile, OParlMeeting, OParlPaper } from '../oparl/types.js';
import {
  upsertBody,
  upsertMeeting,
  upsertOrganization,
  upsertPaper,
  upsertSource,
  type SourceRecord,
  type SyncStats,
} from '../sync/sync.js';

/**
 * Scraper für SessionNet (Somacos), z. B. https://ris.kaiserslautern.de/buergerinfo/.
 * Liest die öffentlichen Seiten Sitzungskalender (si0040), Tagesordnung (si0057) und Vorlage (vo0050)
 * und schreibt OParl-förmige Objekte über die gewohnten upsert-Funktionen ins selbe Datenmodell.
 * IDs sind die Adressen der jeweiligen Seiten, damit sie weltweit eindeutig und verlinkbar bleiben.
 */

// ---------- Hilfen ----------
const BENANNT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—' };

export function text(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => BENANNT[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Datum (TT.MM.JJJJ oder JJJJ-MM-TT) und Uhrzeit (HH:MM) in Europa/Berlin → ISO 8601 mit Versatz. */
export function berlinIso(datum: string, zeit = '00:00'): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(datum);
  const [y, mo, d] = m ? [m[3]!, m[2]!, m[1]!] : datum.split('-');
  const [h, mi] = zeit.split(':');
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Versatz Berlins zu diesem Zeitpunkt ermitteln (Sommer-/Winterzeit)
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23', day: '2-digit' })
    .formatToParts(new Date(utc));
  const hb = Number(teile.find((p) => p.type === 'hour')!.value);
  const db = Number(teile.find((p) => p.type === 'day')!.value);
  let versatz = hb - Number(h);
  if (db !== Number(d)) versatz += db > Number(d) ? 24 : -24;
  const vz = versatz >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  return `${y}-${mo}-${d}T${pad(Number(h))}:${pad(Number(mi))}:00${vz}${pad(versatz)}:00`;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- Lesen der Seiten ----------
export interface Dokument {
  id: string; // getfile-ID
  name: string;
  kuerzel: string | null; // Symbol in SessionNet: VO = Vorlage, B = Bekanntmachung, NS = Niederschrift …
}

export function parseDokumente(html: string): Dokument[] {
  const out: Dokument[] = [];
  // Jedes Dokument steht in einem eigenen Block <div id="smcy…">
  for (const block of html.split(/<div id="smcy\d+"/).slice(1)) {
    const link = /<a\s+href="getfile\.(?:asp|php)\?id=(\d+)&(?:amp;)?type=do"[^>]*class="smce-a-u[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link || out.some((d) => d.id === link[1])) continue;
    const kuerzel = /<i class="smc smc-doc-dakurz[^"]*"[^>]*>([^<]*)<\/i>/.exec(block)?.[1];
    out.push({ id: link[1]!, name: text(link[2]), kuerzel: kuerzel ? text(kuerzel) : null });
  }
  return out;
}

export interface KalenderEintrag {
  /** Sitzungsnummer; fehlt bei nichtöffentlichen Sitzungen ohne Link und Kalendertermin. */
  ksinr: string | null;
  datum: string; // JJJJ-MM-TT
  beginn: string | null; // HH:MM
  ende: string | null;
  gremium: string;
  ort: string | null;
  verlinkt: boolean;
  /** Dokumente in der Kalenderzeile (z. B. Einladung in Koblenz) */
  dokumente: Dokument[];
}

export interface Mandant {
  nr: string;
  name: string;
}

/** Mandanten (Körperschaften) aus dem Filtermenü; der gerade gewählte fehlt in der Liste. */
export function parseMandanten(html: string): Mandant[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\s+href="[^"]*__cpanr=(\d+)[^"]*"[^>]*smcfiltermenumandant[^>]*>([^<]*)<\/a>/g)) {
    out.set(m[1]!, text(m[2]));
  }
  return [...out].map(([nr, name]) => ({ nr, name }));
}

/** Name für die Zuordnung zum Gemeindeverzeichnis („Sickingenstadt Landstuhl“ → „Stadt Landstuhl“). */
export function mandantName(name: string): string {
  const n = name
    .replace(/^\S*stadt\s+/i, 'Stadt ')
    .replace(/^VG\s+/, 'Verbandsgemeinde ')
    // „Verbandsgemeindeverwaltung Trier-Land“ ist die VG; mit Zusatz („… (PV-Rat)“) ein anderes Gremium, bleibt
    .replace(/^Verbandsgemeindeverwaltung\s+([^()]+)$/, 'Verbandsgemeinde $1')
    .trim();
  // Bloße Ortsnamen (Schweich: „Bekond“, „Detzem“) sind Ortsgemeinden; Verbände, Räte u. Ä. bleiben, wie sie sind
  if (!/gemeinde|stadt|verband|zweck|rat\b|anstalt|a[öo]r|forst|kita|kinder|schul|werk|personal|\.\.\./i.test(n) && !/\s/.test(n.replace(/[-/]/g, ''))) {
    return `Ortsgemeinde ${n}`;
  }
  return n;
}

/** Der gerade gewählte Mandant (Beschriftung des Filtermenüs), sofern angezeigt. */
export function aktuellerMandant(html: string): string | null {
  const m = /aria-label="Mandant auswählen"[^>]*>([^<]+)</.exec(html);
  return m ? text(m[1]) || null : null;
}

export function parseKalender(html: string, jahr: number, monat: number): KalenderEintrag[] {
  const out: KalenderEintrag[] = [];
  let tag: number | null = null;
  for (const [, zeile] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const t = /smc_fct_day[^"]*"[^>]*><span class="weekday">(\d+)<\/span>/.exec(zeile!);
    if (t) tag = Number(t[1]);
    const zelle = /<td data-label="Sitzung"[^>]*>([\s\S]*?)<\/td>/.exec(zeile!)?.[1] ?? '';
    if (!text(zelle) || tag === null) continue;
    const link = /href="si005[67]\.(?:asp|php)\?__ksinr=(\d+)"/.exec(zelle);
    const termin = /yvcs\.(?:asp|php)\?key=(\d+)/.exec(zeile!);
    const ksinr = link?.[1] ?? termin?.[1] ?? null;
    const gremium = text(/<div class="smc-el-h[^"]*">([\s\S]*?)<\/div>/.exec(zelle)?.[1]);
    const li = [...zelle.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => text(x[1]));
    const zeit = /(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/.exec(li[0] ?? '');
    out.push({
      ksinr,
      datum: `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`,
      beginn: zeit?.[1]?.padStart(5, '0') ?? null,
      ende: zeit?.[2]?.padStart(5, '0') ?? null,
      gremium,
      ort: li[1]?.replace(/,\s*$/, '') || null,
      verlinkt: !!link,
      dokumente: parseDokumente(/<td data-label="Dokumente"[^>]*>([\s\S]*?)<\/td>/.exec(zeile!)?.[1] ?? ''),
    });
  }
  return out;
}

export interface Top {
  nr: string;
  oeffentlich: boolean | null;
  betreff: string;
  /** Beschluss und Abstimmung, wenn am TOP angegeben (z. B. Koblenz): „ungeändert beschlossen; Ja: 20, Nein: 4 …“ */
  beschluss: string | null;
  vorlage: { kvonr: string; nr: string } | null;
  dokumente: Dokument[];
}

export interface Sitzung {
  name: string | null;
  gremium: string | null;
  ort: string | null;
  datum: string | null; // TT.MM.JJJJ
  zeit: string | null;
  dokumente: Dokument[];
  tops: Top[];
}

const feld = (html: string, klasse: string) =>
  text(new RegExp(`<div class="smc-table-cell ${klasse}">([\\s\\S]*?)</div>`).exec(html)?.[1]) || null;

export function parseSitzung(html: string): Sitzung {
  const tabelle = html.indexOf('smc_page_si0057_contenttable1');
  const kopf = tabelle > 0 ? html.slice(0, tabelle) : html;
  const tops: Top[] = [];
  const tab = tabelle > 0 ? html.slice(tabelle, html.indexOf('</table>', tabelle)) : '';
  for (const [, zeile] of tab.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const nr = text(/<td class="tofnum"[^>]*>([\s\S]*?)<\/td>/.exec(zeile!)?.[1]);
    const zelle = /<td class="tobetr"[^>]*>([\s\S]*?)<\/td>/.exec(zeile!)?.[1] ?? '';
    const titel = /<div class="[^"]*smc-card-header-title-simple[^"]*">([\s\S]*?)<\/div>/.exec(zelle)?.[1];
    const betreff = text(titel ?? zelle);
    const zusatz = [...zelle.matchAll(/<p class="smc_field_smcdv0_box2_\w+[^"]*">([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
    const beschluss = zusatz.length ? zusatz.join('; ').replace(/^Beschluss:\s*/, '') : null;
    if (!nr && !betreff) continue;
    const vo = /href="vo0050\.(?:asp|php)\?__kvonr=(\d+)(?:&[^"]*)?"[^>]*>([\s\S]*?)<\/a>/.exec(zeile!);
    tops.push({
      nr,
      oeffentlich: /^Ö/.test(nr) ? true : /^N/.test(nr) ? false : null,
      betreff,
      beschluss,
      vorlage: vo ? { kvonr: vo[1]!, nr: text(vo[2]) } : null,
      dokumente: parseDokumente(zeile!),
    });
  }
  // Überschrift „Gremium - TT.MM.JJJJ - HH:MM Uhr“ (in beiden Varianten vorhanden)
  const h1 = /^(.*?)\s+-\s+(\d{2}\.\d{2}\.\d{4})(?:\s+-\s+(\d{1,2}:\d{2}))?/.exec(text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(kopf)?.[1]));
  const zeit = feld(kopf, 'yytime');
  return {
    name: feld(kopf, 'siname'),
    gremium: feld(kopf, 'sigrname') ?? h1?.[1] ?? null,
    ort: feld(kopf, 'siort'),
    datum: feld(kopf, 'sidat') ?? h1?.[2] ?? null,
    zeit: zeit ? (/(\d{1,2}:\d{2})/.exec(zeit)?.[1] ?? null) : (h1?.[3] ?? null),
    dokumente: parseDokumente(kopf),
    tops,
  };
}

export interface Vorlage {
  betreff: string | null;
  nr: string | null;
  art: string | null;
  aktenzeichen: string | null;
  dokumente: Dokument[];
}

export function parseVorlage(html: string): Vorlage {
  return {
    betreff: feld(html, 'vobetr'),
    nr: feld(html, 'voname'),
    art: feld(html, 'vovaname')?.replace(/^\d+_/, '') ?? null, // Koblenz: „02_Unterrichtungsvorlage“
    aktenzeichen: feld(html, 'voakz'),
    dokumente: parseDokumente(html),
  };
}

// ---------- Abgleich ----------
export interface SessionNetOptionen {
  /** Monate zurück und voraus, die der Kalender abdeckt. */
  monateZurueck?: number;
  monateVoraus?: number;
  /** Sitzungen, die länger als so viele Tage zurückliegen und schon gespeichert sind, nicht erneut laden. */
  festNachTagen?: number;
  /** Alle Sitzungen im Fenster neu laden (z. B. nach Änderungen am Scraper; CLI: --full). */
  alles?: boolean;
  log?: (msg: string) => void;
  now?: Date;
}

function dokumentZuFile(base: string, d: Dokument, ext: string): OParlFile {
  const url = `${base}getfile.${ext}?id=${d.id}&type=do`;
  return { id: url, name: d.name, accessUrl: url, downloadUrl: url, mimeType: 'application/pdf' } as OParlFile;
}

export async function syncSessionNet(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: SessionNetOptionen = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const base = source.url.endsWith('/') ? source.url : `${source.url}/`;
  // SessionNet gibt es als ASP- (älter) und PHP-Variante; die Seitennamen sind gleich
  const ext = source.endung ?? 'asp';
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };

  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('SessionNet (Scraper)', source.id);
  const bodyId = `${base}#koerperschaft`;
  // Mandanten: Standard (ohne __cpanr, meist die VG) und auf Wunsch alle weiteren aus dem Filtermenü (Ortsgemeinden)
  let info = source.mandanten ? await client.getText(`${base}info.${ext}`) : '';
  // Manche Systeme zeigen das Mandantenmenü nur im Kalender (Trier-Land)
  if (source.mandanten && !parseMandanten(info).length) info = await client.getText(`${base}si0040.${ext}`);
  const aktuell = source.mandanten ? aktuellerMandant(info) : null;
  const bodyName = aktuell ? mandantName(aktuell) : source.name.replace(/^VG /, 'Verbandsgemeinde ');
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: bodyName, shortName: source.id } as never));
  stats.bodies = 1;

  const koerper: Array<{ cpanr: string | null; id: string }> = [{ cpanr: null, id: bodyId }];
  if (source.mandanten) {
    // Der gewählte Mandant steht teils auch in der Liste (Bodenheim) – er ist schon die Standard-Körperschaft
    const liste = parseMandanten(info).filter((m) => !aktuell || m.name !== aktuell);
    for (const m of liste) {
      const id = `${base}#mandant-${m.nr}`;
      tx(db, () => upsertBody(db, source.id, { id, name: mandantName(m.name), shortName: m.nr } as never));
      stats.bodies++;
      koerper.push({ cpanr: m.nr, id });
    }
    log(`  Mandanten: ${liste.length} zusätzlich`);
  }

  // 1. Kalender (je Mandant)
  type Eintrag = KalenderEintrag & { body: string; cpanr: string | null };
  const alle: Eintrag[] = [];
  const von = opts.monateZurueck ?? 2;
  const bis = opts.monateVoraus ?? 3;
  for (const k of koerper) {
    for (let i = -von; i <= bis; i++) {
      const d = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() + i, 1));
      const jahr = d.getUTCFullYear();
      const monat = d.getUTCMonth() + 1;
      const filter = k.cpanr ? `__cpanr=${k.cpanr}&` : '';
      const html = await client.getText(`${base}si0040.${ext}?${filter}__cjahr=${jahr}&__cmonat=${monat}&__canz=1&__cselect=0`);
      alle.push(...parseKalender(html, jahr, monat).map((e) => ({ ...e, body: k.id, cpanr: k.cpanr })));
    }
  }
  // Dieselbe Sitzung nur einmal (bei Mandanten gilt der genauere Eintrag)
  const eindeutig = new Map<string, Eintrag>();
  alle.forEach((e, i) => {
    const schluessel = e.ksinr ?? `${i}`;
    const alt = eindeutig.get(schluessel);
    if (!alt || (!alt.cpanr && e.cpanr)) eindeutig.set(schluessel, e);
  });
  const eintraege = [...eindeutig.values()];
  log(`  Kalender: ${eintraege.length} Sitzungen in ${von + bis + 1} Monaten`);

  // 2. Gremien (je Mandant, da gleichnamige Ausschüsse in mehreren Gemeinden vorkommen)
  const gremien = new Map<string, string>();
  const gremiumSchluessel = (e: Eintrag) => `${e.cpanr ?? ''}|${e.gremium}`;
  for (const e of eintraege) {
    if (!e.gremium || gremien.has(gremiumSchluessel(e))) continue;
    const id = e.cpanr ? `${base}#gremium-${e.cpanr}-${slug(e.gremium)}` : `${base}#gremium-${slug(e.gremium)}`;
    gremien.set(gremiumSchluessel(e), id);
    tx(db, () => upsertOrganization(db, e.body, { id, name: e.gremium, organizationType: 'Gremium' } as never));
    stats.organizations++;
  }

  // 3. Sitzungen
  const vorlagenGesehen = new Map<string, string>(); // kvonr → Körperschaft
  const festVor = new Date(jetzt.getTime() - (opts.festNachTagen ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?');
  for (const e of eintraege) {
    const meetingId = e.ksinr
      ? `${base}si0057.${ext}?__ksinr=${e.ksinr}`
      : `${base}si0040.${ext}#${e.cpanr ? `${e.cpanr}-` : ''}${e.datum}-${slug(e.gremium)}`;
    const start = berlinIso(e.datum, e.beginn ?? '00:00');
    const vergangen = start < jetzt.toISOString();
    if (!opts.alles && e.verlinkt && e.datum < festVor && (vorhanden.get(meetingId) as { n: number }).n > 0) continue;

    let s: Sitzung | null = null;
    if (e.verlinkt) {
      try {
        s = parseSitzung(await client.getText(meetingId));
      } catch (err) {
        log(`    Sitzung ${e.ksinr}: ${(err as Error).message}`);
      }
    }
    const orgId = gremien.get(gremiumSchluessel(e));
    const agendaItem = (s?.tops ?? []).map((t, i) => {
      const paperId = t.vorlage ? `${base}vo0050.${ext}?__kvonr=${t.vorlage.kvonr}` : null;
      if (t.vorlage && !vorlagenGesehen.has(t.vorlage.kvonr)) vorlagenGesehen.set(t.vorlage.kvonr, e.body);
      return {
        id: `${meetingId}#top-${i + 1}`,
        number: t.nr.replace(/^[ÖN]\s*/, ''),
        order: i + 1,
        name: t.betreff,
        result: t.beschluss ?? undefined,
        public: t.oeffentlich ?? undefined,
        consultation: paperId ? `${paperId}#${e.ksinr ?? i}` : undefined,
        vorlage: paperId,
      };
    });
    const docs = s?.dokumente.length ? s.dokumente : e.dokumente;
    const einladung = docs.find((d) => d.kuerzel === 'B' || /bekanntmachung|einladung/i.test(d.name));
    const protokoll = docs.find((d) => /^N|^P/.test(d.kuerzel ?? '') || /niederschrift|protokoll/i.test(d.name));
    const meeting = {
      id: meetingId,
      name: s?.gremium ?? e.gremium,
      meetingState: e.verlinkt ? (vergangen ? 'durchgeführt' : 'eingeladen') : 'terminiert',
      start,
      end: e.ende ? berlinIso(e.datum, e.ende) : undefined,
      location: s?.ort ?? e.ort ? { description: s?.ort ?? e.ort ?? undefined } : undefined,
      organization: orgId ? [orgId] : [],
      agendaItem,
      invitation: einladung ? dokumentZuFile(base, einladung, ext) : undefined,
      resultsProtocol: protokoll && protokoll !== einladung ? dokumentZuFile(base, protokoll, ext) : undefined,
      auxiliaryFile: docs.filter((d) => d !== einladung && d !== protokoll).map((d) => dokumentZuFile(base, d, ext)),
      quelle: 'sessionnet',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, e.body, meeting, stats));
    stats.meetings++;
  }
  log(`    Sitzungen: ${stats.meetings} gelesen`);

  // 4. Vorlagen: neue immer, bekannte nur, wenn sie in einer jetzt gelesenen Sitzung vorkommen (Beratungsfolge)
  const bekannt = db.prepare('SELECT raw FROM paper WHERE id = ?');
  const auftritte = db.prepare(
    `SELECT a.id AS ai, a.meeting_id AS mid, m.start, mo.organization_id AS org
     FROM agenda_item a JOIN meeting m ON m.id = a.meeting_id
     LEFT JOIN meeting_organization mo ON mo.meeting_id = m.id
     WHERE a.consultation_id LIKE ? ORDER BY m.start`,
  );
  for (const [kvonr, vorlageBody] of vorlagenGesehen) {
    const paperId = `${base}vo0050.${ext}?__kvonr=${kvonr}`;
    const alt = bekannt.get(paperId) as { raw: string } | undefined;
    let v: Vorlage;
    const gespeichert = alt ? (JSON.parse(alt.raw).vorlage as Vorlage | undefined) : undefined;
    // Gespeicherte Vorlagen nicht erneut laden – außer sie hatten noch keine Dokumente
    if (gespeichert?.dokumente?.length) {
      v = gespeichert;
    } else {
      try {
        v = parseVorlage(await client.getText(paperId));
      } catch (err) {
        log(`    Vorlage ${kvonr}: ${(err as Error).message}`);
        continue;
      }
    }
    const rows = auftritte.all(`${paperId}#%`) as Array<{ ai: string; mid: string; start: string; org: string | null }>;
    const haupt = v.dokumente.find((d) => d.kuerzel === 'VO') ?? v.dokumente[0];
    const paper = {
      id: paperId,
      name: v.betreff ?? undefined,
      reference: v.nr ?? undefined,
      date: rows[0]?.start?.slice(0, 10),
      paperType: v.art ?? undefined,
      mainFile: haupt ? dokumentZuFile(base, haupt, ext) : undefined,
      auxiliaryFile: v.dokumente.filter((d) => d !== haupt).map((d) => dokumentZuFile(base, d, ext)),
      consultation: rows.map((r) => ({
        id: `${paperId}#${new URL(r.mid).searchParams.get('__ksinr') ?? r.ai}`,
        agendaItem: r.ai,
        meeting: r.mid,
        organization: r.org ? [r.org] : [],
      })),
      vorlage: v,
      quelle: 'sessionnet',
    } as unknown as OParlPaper;
    tx(db, () => upsertPaper(db, vorlageBody, paper, stats));
    stats.papers++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
