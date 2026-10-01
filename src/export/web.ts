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
  const pfad = /^\/(bi|public|buergerinfo)\//.exec(u.pathname)?.[0] ?? '/';
  return `${u.protocol}//${u.host}${pfad}`;
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
  const quellen = sources.map(({ id }) => {
    const snap = buildSnapshot(db, id, { now, pastMeetings: 6, papers: 15, textLength: 1600 });
    const vorlagen = snap.vorlagen.map((v) => (kurz[v.id] ? { ...v, kurz: kurz[v.id] } : v));

    const gebiet = gebietVon.get(id);
    const zu = gebiet ? zuordnen(gebiete, gebiet, snap.koerperschaften) : new Map<string, string>();
    const gebietVonBody = new Map([...zu].map(([g, b]) => [b, g]));
    for (const [g, b] of zu) if (!daten[g]) daten[g] = [id, b];

    const koerperschaften = snap.koerperschaften.map((k) => ({ ...k, gebiet: gebietVonBody.get(k.id) ?? null }));
    writeFileSync(join(outDir, 'data', `${id}.json`), JSON.stringify({ ...snap, koerperschaften, vorlagen }));

    const kommend = new Map<string, number>();
    for (const m of snap.sitzungen) {
      if (m.start && m.start >= snap.stichtag && !m.abgesagt) kommend.set(m.k, (kommend.get(m.k) ?? 0) + 1);
    }
    return {
      ...snap.quelle,
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

  const mitDaten = gebiete.gemeinden.filter((g) => daten[g.id] || (g.vg && daten[g.vg])).length;
  return { quellen: quellen.length, gebiete: Object.keys(daten).length, gemeindenMitDaten: mitDaten, gemeinden: gebiete.gemeinden.length };
}
