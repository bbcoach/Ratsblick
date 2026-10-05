import type { DatabaseSync } from 'node:sqlite';

/**
 * Quellenstatus: jeder Abgleich schreibt eine Zeile in `sync_log`; daraus entstehen Ampel, Veränderungen seit dem
 * vorigen Abgleich und Warnungen. Gedacht für das verschlüsselte Admin-Dashboard und die Warn-Mail (GitHub-Issue).
 */

export interface LogErgebnis {
  ok: boolean;
  fehler?: string;
  dauerS: number;
  /** Beobachtungen des Abrufs (siehe `OParlClient.beobachtung`) */
  version?: string;
  umleitung?: string;
}

export interface QuelleInfo {
  id: string;
  name: string;
  typ?: string;
  ebene?: string;
}

export interface QuellenStatus {
  id: string;
  name: string;
  typ: string;
  ebene: string;
  ampel: 'ok' | 'warnung' | 'fehler' | 'unbekannt';
  letzterAbgleich: string | null;
  letzterErfolg: string | null;
  alterStunden: number | null;
  fehler: string | null;
  sitzungen: number;
  kuenftig: number;
  vorlagen: number;
  /** Veränderung gegenüber dem vorigen erfolgreichen Abgleich */
  delta: { sitzungen: number; vorlagen: number } | null;
  letzteSitzung: string | null;
  version: string | null;
  umleitung: string | null;
  /** Anteil der Sitzungen der letzten 120 Tage mit Tagesordnung bzw. Dokumenten (0–1), null bei zu wenig Sitzungen */
  anteilTops: number | null;
  anteilDok: number | null;
}

export interface Warnung {
  id: string;
  name: string;
  art: 'fehler' | 'veraltet' | 'leer' | 'einbruch' | 'inhalt' | 'adresse' | 'version';
  text: string;
}

export interface Status {
  erstellt: string;
  quellen: QuellenStatus[];
  warnungen: Warnung[];
  zusammenfassung: { quellen: number; ok: number; warnung: number; fehler: number; sitzungen: number; vorlagen: number; kuenftig: number };
}

/** Schwellen: ohne erfolgreichen Abgleich seit … Stunden gilt eine Quelle als veraltet (Zeitbudget schiebt einzelne Quellen auf). */
export const VERALTET_STUNDEN = 36;
export const EINBRUCH_ANTEIL = 0.3;
export const EINBRUCH_MINDEST = 5;
/** Plausibilität: Fenster (Tage) und Mindestzahl vergangener Sitzungen; Warnung, wenn der Anteil um so viel unter den üblichen fällt. */
export const INHALT_TAGE = 120;
export const INHALT_MINDEST = 5;
export const INHALT_FALL = 0.3;
export const INHALT_BASIS_MIN = 0.3;

const zaehle = (db: DatabaseSync, sourceId: string, jetzt: Date) =>
  db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM meeting m JOIN body b ON b.id = m.body_id WHERE b.source_id = ?1 AND m.deleted = 0) AS sitzungen,
         (SELECT COUNT(*) FROM meeting m JOIN body b ON b.id = m.body_id WHERE b.source_id = ?1 AND m.deleted = 0 AND m.start >= ?2) AS kuenftig,
         (SELECT COUNT(*) FROM paper p JOIN body b ON b.id = p.body_id WHERE b.source_id = ?1 AND p.deleted = 0) AS vorlagen`,
    )
    .get(sourceId, jetzt.toISOString().slice(0, 10)) as { sitzungen: number; kuenftig: number; vorlagen: number };

/** Sitzungen der letzten Monate und wie viele davon Tagesordnungspunkte bzw. Dokumente haben (erkennt stille Layoutänderungen). */
const inhalt = (db: DatabaseSync, sourceId: string, jetzt: Date) =>
  db
    .prepare(
      `SELECT COUNT(*) AS vergangen,
         COALESCE(SUM(EXISTS (SELECT 1 FROM agenda_item a WHERE a.meeting_id = m.id)), 0) AS mit_tops,
         COALESCE(SUM(EXISTS (SELECT 1 FROM file_link f WHERE f.owner_type = 'meeting' AND f.owner_id = m.id)), 0) AS mit_dok
       FROM meeting m JOIN body b ON b.id = m.body_id
       WHERE b.source_id = ?1 AND m.deleted = 0 AND m.cancelled = 0 AND m.start >= ?2 AND m.start < ?3`,
    )
    .get(sourceId, new Date(jetzt.getTime() - INHALT_TAGE * 86_400_000).toISOString().slice(0, 10), jetzt.toISOString().slice(0, 10)) as {
    vergangen: number;
    mit_tops: number;
    mit_dok: number;
  };

/** Schreibt das Ergebnis eines Abgleichs (Erfolg oder Fehler) samt aktuellem Datenstand der Quelle. */
export function schreibeLog(db: DatabaseSync, sourceId: string, r: LogErgebnis, jetzt = new Date()): void {
  const z = zaehle(db, sourceId, jetzt);
  const i = inhalt(db, sourceId, jetzt);
  db.prepare(
    'INSERT INTO sync_log (source_id, at, ok, error, dauer_s, sitzungen, kuenftig, vorlagen, version, umleitung, vergangen, mit_tops, mit_dok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sourceId, jetzt.toISOString(), r.ok ? 1 : 0, r.ok ? null : (r.fehler ?? 'unbekannter Fehler').slice(0, 300), r.dauerS,
    z.sitzungen, z.kuenftig, z.vorlagen, r.version ?? null, r.umleitung ?? null, i.vergangen, i.mit_tops, i.mit_dok,
  );
  // Protokoll begrenzen: je Quelle die letzten 200 Einträge
  db.prepare('DELETE FROM sync_log WHERE source_id = ? AND id NOT IN (SELECT id FROM sync_log WHERE source_id = ? ORDER BY id DESC LIMIT 200)').run(sourceId, sourceId);
}

interface LogRow {
  at: string;
  ok: number;
  error: string | null;
  sitzungen: number | null;
  vorlagen: number | null;
  version: string | null;
  umleitung: string | null;
  vergangen: number | null;
  mit_tops: number | null;
  mit_dok: number | null;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const anteil = (n: number | null, von: number | null) => (von !== null && von >= INHALT_MINDEST && n !== null ? n / von : null);

export function baueStatus(db: DatabaseSync, quellen: QuelleInfo[], jetzt = new Date()): Status {
  const quellenStatus: QuellenStatus[] = [];
  const warnungen: Warnung[] = [];
  for (const q of quellen) {
    const log = db.prepare('SELECT at, ok, error, sitzungen, vorlagen, version, umleitung, vergangen, mit_tops, mit_dok FROM sync_log WHERE source_id = ? ORDER BY id DESC LIMIT 60').all(q.id) as unknown as LogRow[];
    const letzter = log[0] ?? null;
    const erfolge = log.filter((l) => l.ok === 1);
    const letzterErfolg = erfolge[0] ?? null;
    const voriger = erfolge[1] ?? null;
    const z = zaehle(db, q.id, jetzt);
    const letzteSitzung = (
      db.prepare('SELECT MAX(m.start) AS s FROM meeting m JOIN body b ON b.id = m.body_id WHERE b.source_id = ? AND m.deleted = 0').get(q.id) as { s: string | null }
    ).s;
    const alter = letzterErfolg ? Math.round((jetzt.getTime() - Date.parse(letzterErfolg.at)) / 36e5) : null;
    const delta = letzterErfolg && voriger ? { sitzungen: (letzterErfolg.sitzungen ?? 0) - (voriger.sitzungen ?? 0), vorlagen: (letzterErfolg.vorlagen ?? 0) - (voriger.vorlagen ?? 0) } : null;

    let ampel: QuellenStatus['ampel'] = letzter ? 'ok' : 'unbekannt';
    const melde = (art: Warnung['art'], text: string, stufe: 'warnung' | 'fehler') => {
      warnungen.push({ id: q.id, name: q.name, art, text });
      if (ampel !== 'fehler') ampel = stufe;
    };
    if (letzter && letzter.ok === 0) melde('fehler', `Abgleich fehlgeschlagen: ${letzter.error ?? 'unbekannter Fehler'}`, 'fehler');
    if (alter !== null && alter > VERALTET_STUNDEN) melde('veraltet', `seit ${alter} h kein erfolgreicher Abgleich`, 'warnung');
    if (letzterErfolg && z.sitzungen === 0) melde('leer', 'keine einzige Sitzung gespeichert', 'fehler');
    if (delta && voriger && (voriger.sitzungen ?? 0) >= EINBRUCH_MINDEST && -delta.sitzungen >= (voriger.sitzungen ?? 0) * EINBRUCH_ANTEIL) {
      melde('einbruch', `Sitzungen von ${voriger.sitzungen} auf ${letzterErfolg!.sitzungen} gefallen`, 'warnung');
    }
    // stille Veränderungen: weniger Tagesordnungen/Dokumente als sonst, Umleitung auf andere Adresse, neue Softwareversion
    const aktuellTops = letzterErfolg ? anteil(letzterErfolg.mit_tops, letzterErfolg.vergangen) : null;
    const aktuellDok = letzterErfolg ? anteil(letzterErfolg.mit_dok, letzterErfolg.vergangen) : null;
    const frueher = erfolge.slice(1, 9);
    for (const [name, aktuell, wert] of [['Tagesordnungen', aktuellTops, (l: LogRow) => anteil(l.mit_tops, l.vergangen)], ['Dokumente', aktuellDok, (l: LogRow) => anteil(l.mit_dok, l.vergangen)]] as const) {
      const basis = frueher.map(wert).filter((x): x is number => x !== null);
      if (aktuell !== null && basis.length >= 2) {
        const ueblich = median(basis);
        if (ueblich >= INHALT_BASIS_MIN && aktuell <= ueblich - INHALT_FALL) {
          melde('inhalt', `${name}: nur noch ${Math.round(aktuell * 100)} % der Sitzungen der letzten ${INHALT_TAGE} Tage (üblich ${Math.round(ueblich * 100)} %) – Layout der Seite geändert?`, 'warnung');
        }
      }
    }
    if (letzterErfolg?.umleitung) melde('adresse', `leitet auf ${letzterErfolg.umleitung} um – Adresse in endpoints.json prüfen`, 'warnung');
    const versionVorher = erfolge.slice(1).find((l) => l.version)?.version ?? null;
    if (letzterErfolg?.version && versionVorher && letzterErfolg.version !== versionVorher) {
      melde('version', `Softwareversion von ${versionVorher} auf ${letzterErfolg.version} gewechselt – Abruf stichprobenartig prüfen`, 'warnung');
    }
    quellenStatus.push({
      id: q.id, name: q.name, typ: q.typ ?? 'oparl', ebene: q.ebene ?? '', ampel,
      letzterAbgleich: letzter?.at ?? null, letzterErfolg: letzterErfolg?.at ?? null, alterStunden: alter,
      fehler: letzter && letzter.ok === 0 ? letzter.error : null,
      sitzungen: z.sitzungen, kuenftig: z.kuenftig, vorlagen: z.vorlagen, delta, letzteSitzung,
      version: log.find((l) => l.version)?.version ?? null, umleitung: letzterErfolg?.umleitung ?? null, anteilTops: aktuellTops, anteilDok: aktuellDok,
    });
  }
  const summe = (f: (q: QuellenStatus) => number) => quellenStatus.reduce((a, q) => a + f(q), 0);
  return {
    erstellt: jetzt.toISOString(),
    quellen: quellenStatus,
    warnungen,
    zusammenfassung: {
      quellen: quellenStatus.length,
      ok: quellenStatus.filter((q) => q.ampel === 'ok').length,
      warnung: quellenStatus.filter((q) => q.ampel === 'warnung').length,
      fehler: quellenStatus.filter((q) => q.ampel === 'fehler').length,
      sitzungen: summe((q) => q.sitzungen),
      vorlagen: summe((q) => q.vorlagen),
      kuenftig: summe((q) => q.kuenftig),
    },
  };
}

/** Text für das Warn-Issue (leer, wenn nichts auffällig ist). Erste Zeile: Kennung der Warnungen, damit Änderungen auffallen. */
export function warnungenMarkdown(status: Status): string {
  if (!status.warnungen.length) return '';
  const kennung = status.warnungen.map((w) => `${w.id}:${w.art}`).sort().join(',');
  const zeilen = status.warnungen.map((w) => `- **${w.name}** (\`${w.id}\`): ${w.text}`);
  return `<!-- kennung:${kennung} -->\n${status.warnungen.length} Quelle(n) auffällig (Stand ${status.erstellt.slice(0, 16).replace('T', ' ')} UTC):\n\n${zeilen.join('\n')}\n`;
}
