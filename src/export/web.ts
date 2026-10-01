import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { buildSnapshot } from './snapshot.js';

/**
 * Baut die Web-App (PWA) als statische Seite: App-Dateien aus `web/`, dazu je Quelle eine Datendatei
 * und ein Verzeichnis aller Kommunen. Ergebnis lässt sich direkt auf GitHub Pages veröffentlichen.
 */

export interface WebBuildOptions {
  webDir?: string;
  /** Handgeschriebene Zusammenfassungen „Kurz erklärt“, Schlüssel ist die Vorlagen-ID. */
  kurzPath?: string;
  now?: Date;
}

interface Kurz {
  text: string;
  punkte?: string[];
}

export function buildWeb(db: DatabaseSync, outDir: string, opts: WebBuildOptions = {}) {
  const webDir = opts.webDir ?? 'web';
  const kurzPath = opts.kurzPath ?? 'data/kurz-erklaert.json';
  const now = opts.now ?? new Date();
  const kurz: Record<string, Kurz> = existsSync(kurzPath) ? JSON.parse(readFileSync(kurzPath, 'utf8')) : {};

  rmSync(outDir, { recursive: true, force: true });
  cpSync(webDir, outDir, { recursive: true });
  mkdirSync(join(outDir, 'data'), { recursive: true });

  const build = now.toISOString();
  const sw = join(outDir, 'sw.js');
  if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD__', build));

  const sources = db
    .prepare(
      `SELECT s.id FROM source s WHERE EXISTS (SELECT 1 FROM body b WHERE b.source_id = s.id) ORDER BY s.name`,
    )
    .all() as Array<{ id: string }>;

  const quellen = sources.map(({ id }) => {
    const snap = buildSnapshot(db, id, { now, pastMeetings: 6, papers: 15, textLength: 1600 });
    const vorlagen = snap.vorlagen.map((v) => (kurz[v.id] ? { ...v, kurz: kurz[v.id] } : v));
    writeFileSync(join(outDir, 'data', `${id}.json`), JSON.stringify({ ...snap, vorlagen }));

    const kommend = new Map<string, number>();
    for (const m of snap.sitzungen) {
      if (m.start && m.start >= snap.stichtag && !m.abgesagt) kommend.set(m.k, (kommend.get(m.k) ?? 0) + 1);
    }
    return {
      ...snap.quelle,
      host: snap.quelle.system ? new URL(snap.quelle.system).hostname : null,
      vg: snap.vg,
      sitzungen: snap.sitzungen.length,
      vorlagen: vorlagen.length,
      koerperschaften: snap.koerperschaften.map((k) => ({ ...k, kommend: kommend.get(k.id) ?? 0 })),
    };
  });

  writeFileSync(join(outDir, 'data', 'index.json'), JSON.stringify({ erstellt: build, quellen }));
  return { quellen: quellen.length, koerperschaften: quellen.reduce((n, q) => n + q.koerperschaften.length, 0) };
}
