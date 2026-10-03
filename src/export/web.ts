import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Gebiete } from '../sync/discover.js';
import type { SourceRecord } from '../sync/sync.js';
import { zuordnen } from './gebiete.js';
import { buildSnapshot } from './snapshot.js';

/**
 * Baut die Web-App (PWA) als statische Seite: App-Dateien aus `web/`, je Quelle eine Datendatei
 * und ein Verzeichnis (`data/index.json`) mit allen Gebietskörperschaften des Landes, der Zuordnung
 * Gebiet → Quelle/Körperschaft und bekannten, aber nicht abrufbaren Ratsinformationssystemen.
 */

export interface WebBuildOptions {
  webDir?: string;
  /** Handgeschriebene Zusammenfassungen „Kurz erklärt“, Schlüssel ist die Vorlagen-ID. */
  kurzPath?: string;
  gebietePath?: string;
  endpointsPath?: string;
  now?: Date;
}

interface Kurz {
  text: string;
  punkte?: string[];
}

/** Startseite eines Ratsinformationssystems aus der OParl-Adresse ableiten (nur als Link für Menschen). */
export function risStartseite(oparlUrl: string): string {
  const u = new URL(oparlUrl);
  if (/\/termine\/ics\//i.test(u.pathname)) return `${u.protocol}//${u.host}/`; // Kalenderexport (SD.NET RIM)
  if (!/oparl/i.test(u.pathname)) return oparlUrl; // schon die Startseite (Systeme ohne OParl)
  const pfad = /^\/(bi|public|buergerinfo)\//.exec(u.pathname)?.[0] ?? '/';
  return `${u.protocol}//${u.host}${pfad}`;
}

/**
 * Eintrag der Themensuche: [Art (0 = Vorlage, 1 = TOP), Titel, Datum JJJJ-MM-TT, Quelle (Index), Gebiet, Ziel-ID, Nummer].
 * Ziel ist die Vorlage bzw. bei TOPs die Sitzung. Gebiet = Gebietskörperschaft der Körperschaft, sonst die der Quelle.
 */
export type SuchEintrag = [0 | 1, string, string | null, number, string | null, string, string | null];

/** Formalien der Tagesordnung, die bei der Themensuche nur stören. */
const FORMALIE =
  /^(?:er[öo]ffnung|begr[üu][ßs]ung|feststellung|genehmigung (?:der|des) (?:niederschrift|protokolls)|mitteilungen|anfragen|verschiedenes|einwohnerfragestunde|bekanntgabe|informationen?|sonstiges)\b/i;

export function suchEintraege(
  qi: number,
  quellGebiet: string | null,
  gebietVonBody: Map<string, string>,
  sitzungen: Array<{ id: string; k: string; start: string | null; tops: Array<{ name: string | null; oeffentlich: boolean | null; vorlage: string | null }> }>,
  vorlagen: Array<{ id: string; k: string; name: string | null; nr: string | null; datum: string | null }>,
): SuchEintrag[] {
  const out: SuchEintrag[] = [];
  const gebiet = (k: string) => gebietVonBody.get(k) ?? quellGebiet;
  for (const v of vorlagen) if (v.name) out.push([0, v.name, v.datum?.slice(0, 10) ?? null, qi, gebiet(v.k), v.id, v.nr]);
  const vorlagenIds = new Set(vorlagen.map((v) => v.id));
  for (const m of sitzungen) {
    const gesehen = new Set<string>();
    for (const t of m.tops) {
      const name = t.name?.replace(/\s+/g, ' ').trim();
      // TOPs mit Vorlage erscheinen über die Vorlage; nicht öffentliche und Formalien weglassen
      if (!name || t.oeffentlich === false || (t.vorlage && vorlagenIds.has(t.vorlage)) || FORMALIE.test(name) || gesehen.has(name)) continue;
      gesehen.add(name);
      out.push([1, name, m.start?.slice(0, 10) ?? null, qi, gebiet(m.k), m.id, null]);
    }
  }
  return out;
}

export function buildWeb(db: DatabaseSync, outDir: string, opts: WebBuildOptions = {}) {
  const webDir = opts.webDir ?? 'web';
  const kurzPath = opts.kurzPath ?? 'data/kurz-erklaert.json';
  const now = opts.now ?? new Date();
  const read = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback);
  const kurz = read<Record<string, Kurz>>(kurzPath, {});
  const gebiete = read<Gebiete & { stand?: string }>(opts.gebietePath ?? 'data/gebiete-rlp.json', {
    kreise: [], verbandsgemeinden: [], gemeinden: [],
  });
  const endpoints = read<{ endpoints: SourceRecord[] }>(opts.endpointsPath ?? 'data/endpoints.json', { endpoints: [] }).endpoints;
  const gebietVon = new Map(endpoints.map((e) => [e.id, e.gebiet]));
  const urlVon = new Map(endpoints.map((e) => [e.id, e.url]));
  const typVon = new Map(endpoints.map((e) => [e.id, e.typ]));

  rmSync(outDir, { recursive: true, force: true });
  cpSync(webDir, outDir, { recursive: true });
  mkdirSync(join(outDir, 'data'), { recursive: true });

  const build = now.toISOString();
  const sw = join(outDir, 'sw.js');
  if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD__', build));

  const sources = db
    .prepare(`SELECT s.id FROM source s WHERE EXISTS (SELECT 1 FROM body b WHERE b.source_id = s.id) ORDER BY s.name`)
    .all() as Array<{ id: string }>;

  // Gebiet → [Quelle, Körperschaft]
  const daten: Record<string, [string, string]> = {};
  // Themensuche: Titel aller Vorlagen und öffentlichen TOPs im aktuellen Datenstand
  const suche: SuchEintrag[] = [];
  const quellen = sources.map(({ id }, qi) => {
    const snap = buildSnapshot(db, id, { now, pastMeetings: 6, papers: 15, textLength: 1600 });
    const vorlagen = snap.vorlagen.map((v) => (kurz[v.id] ? { ...v, kurz: kurz[v.id] } : v));

    const gebiet = gebietVon.get(id);
    const zu = gebiet ? zuordnen(gebiete, gebiet, snap.koerperschaften) : new Map<string, string>();
    const gebietVonBody = new Map([...zu].map(([g, b]) => [b, g]));
    for (const [g, b] of zu) if (!daten[g]) daten[g] = [id, b];

    const koerperschaften = snap.koerperschaften.map((k) => ({ ...k, gebiet: gebietVonBody.get(k.id) ?? null }));
    // Startseite des Original-RIS, damit man dort nach weiteren Daten suchen kann
    const quelleUrl = urlVon.get(id) ?? snap.quelle.system;
    const ris = quelleUrl ? risStartseite(quelleUrl) : null;
    // Kalenderexport: der Anbieter stellt nur Termine bereit, Tagesordnungen und Vorlagen nur im eigenen RIS
    const quelle = { ...snap.quelle, ris, ...(typVon.get(id) === 'ics' ? { nurTermine: true } : {}),
      // Kein Ratsinformationssystem, sondern Seiten der Website (Protokolllisten, Politik-Modul): Links sprechen dann von der Website
      ...(typVon.get(id) === 'protokolle' || typVon.get(id) === 'edith' ? { ohneRis: true } : {}) };
    writeFileSync(join(outDir, 'data', `${id}.json`), JSON.stringify({ ...snap, quelle, koerperschaften, vorlagen }));
    suche.push(...suchEintraege(qi, gebiet ?? null, gebietVonBody, snap.sitzungen, vorlagen));

    const kommend = new Map<string, number>();
    for (const m of snap.sitzungen) {
      if (m.start && m.start >= snap.stichtag && !m.abgesagt) kommend.set(m.k, (kommend.get(m.k) ?? 0) + 1);
    }
    return {
      ...quelle,
      gebiet: gebiet ?? null,
      host: snap.quelle.system ? new URL(snap.quelle.system).hostname : null,
      vg: snap.vg,
      // Körperschaften ohne Gebietskörperschaft (Zweckverbände u. a.) bleiben über die Suche erreichbar
      weitere: koerperschaften.filter((k) => !k.gebiet).map((k) => ({ id: k.id, name: k.name, art: k.art, plz: k.plz })),
      kommend: Object.fromEntries(kommend),
    };
  });

  // Bekannte Systeme ohne abrufbare Daten (nicht freigeschaltet, robots.txt-Verbot, Fehler)
  const ris: Record<string, { url: string; status: string }> = {};
  for (const e of endpoints) {
    if (e.gebiet && !daten[e.gebiet] && !quellen.some((q) => q.id === e.id)) {
      ris[e.gebiet] = { url: risStartseite(e.url), status: e.status ?? 'unbekannt' };
    }
  }

  // Kompakte Listen: [id, name, art, plz, kreis, vg, einwohner]
  const index = {
    erstellt: build,
    stand: gebiete.stand ?? null,
    kreise: gebiete.kreise.map((k) => [k.id, k.name, k.art]),
    vgs: gebiete.verbandsgemeinden.map((v) => [v.id, v.name, v.kreis]),
    gemeinden: (gebiete.gemeinden as Array<Gebiete['gemeinden'][number] & { plz?: string | null; einwohner?: number | null }>)
      .map((g) => [g.id, g.name, g.art, g.plz ?? null, g.kreis, g.vg, g.einwohner ?? null]),
    daten,
    ris,
    quellen,
  };
  writeFileSync(join(outDir, 'data', 'index.json'), JSON.stringify(index));
  suche.sort((a, b) => String(b[2]).localeCompare(String(a[2])));
  writeFileSync(join(outDir, 'data', 'suche.json'), JSON.stringify({ erstellt: build, quellen: quellen.map((q) => q.id), eintraege: suche }));

  // Sitzverteilung der Räte (Kommunalwahl 2024, scripts/sitzverteilung.ts) – lädt die App erst auf der Kommunenseite
  if (existsSync('data/sitze-2024.json')) cpSync('data/sitze-2024.json', join(outDir, 'data', 'sitze.json'));

  const mitDaten = gebiete.gemeinden.filter((g) => daten[g.id] || (g.vg && daten[g.vg])).length;
  const eigen = gebiete.gemeinden.filter((g) => daten[g.id]).length;
  return { quellen: quellen.length, gebiete: Object.keys(daten).length, gemeindenMitDaten: mitDaten, gemeindenEigen: eigen, gemeinden: gebiete.gemeinden.length };
}
