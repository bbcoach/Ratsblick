import { writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Momentaufnahme einer Quelle als kompaktes JSON für Prototypen der Oberfläche.
 * Je Körperschaft: alle kommenden Sitzungen, die letzten abgeschlossenen und die neuesten Vorlagen.
 */

export interface SnapshotOptions {
  /** Stichtag für „kommend“; Standard: jetzt. */
  now?: Date;
  pastMeetings?: number;
  papers?: number;
  /** Höchstlänge der Textauszüge aus PDFs. */
  textLength?: number;
}

interface FileRef {
  name: string;
  rolle: string;
  url: string | null;
}

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Glättet Text aus PDFs: Seitenvorschübe, Zeilenumbrüche und Mehrfachleerzeichen. */
export function cleanText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.replace(/[\f\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).replace(/\s\S*$/, '')} …` : t;
}

function art(name: string): string {
  if (name.startsWith('Ortsgemeinde')) return 'Ortsgemeinde';
  if (name.startsWith('Stadt')) return 'Stadt';
  if (name.startsWith('Verbandsgemeinde')) return 'Verbandsgemeinde';
  if (/zweckverband/i.test(name)) return 'Zweckverband';
  return 'Sonstige';
}

export function buildSnapshot(db: DatabaseSync, sourceId: string, opts: SnapshotOptions = {}) {
  const now = (opts.now ?? new Date()).toISOString();
  const pastMeetings = opts.pastMeetings ?? 8;
  const paperLimit = opts.papers ?? 20;
  const textLength = opts.textLength ?? 2400;
  const all = (sql: string, ...args: Array<string | number | null>) => db.prepare(sql).all(...args) as Row[];

  const source = db.prepare('SELECT * FROM source WHERE id = ?').get(sourceId) as Row | undefined;
  if (!source) throw new Error(`Quelle ${sourceId} ist nicht in der Datenbank – zuerst npm run sync`);

  const bodies = all('SELECT id, name, raw FROM body WHERE source_id = ? ORDER BY name', sourceId);
  const gremien = new Map<string, string>();
  for (const o of all(
    'SELECT o.id, o.name FROM organization o JOIN body b ON b.id = o.body_id WHERE b.source_id = ?',
    sourceId,
  )) {
    gremien.set(String(o.id), String(o.name));
  }

  const filesOf = (ownerType: string, ownerId: string): FileRef[] =>
    all(
      `SELECT f.name, f.access_url, l.role FROM file_link l JOIN file f ON f.id = l.file_id
       WHERE l.owner_type = ? AND l.owner_id = ?
       ORDER BY CASE l.role WHEN 'main' THEN 0 WHEN 'invitation' THEN 1 WHEN 'resultsProtocol' THEN 2 ELSE 3 END, f.name`,
      ownerType,
      ownerId,
    ).map((f) => ({ name: String(f.name ?? 'Dokument'), rolle: String(f.role), url: s(f.access_url) }));

  const meetingIds = new Set<string>();
  const paperIds = new Set<string>();

  for (const b of bodies) {
    const id = String(b.id);
    for (const m of all(
      `SELECT id FROM meeting WHERE body_id = ? AND deleted = 0 AND start >= ? ORDER BY start`,
      id,
      now,
    )) {
      meetingIds.add(String(m.id));
    }
    for (const m of all(
      `SELECT id FROM meeting WHERE body_id = ? AND deleted = 0 AND start < ? ORDER BY start DESC LIMIT ?`,
      id,
      now,
      pastMeetings,
    )) {
      meetingIds.add(String(m.id));
    }
    for (const p of all(
      `SELECT id FROM paper WHERE body_id = ? AND deleted = 0 ORDER BY date DESC, reference DESC LIMIT ?`,
      id,
      paperLimit,
    )) {
      paperIds.add(String(p.id));
    }
  }

  // Vorlagen, die auf den ausgewählten Tagesordnungen stehen, gehören mit in die Momentaufnahme.
  const sitzungen = [...meetingIds].map((mid) => {
    const m = db.prepare('SELECT * FROM meeting WHERE id = ?').get(mid) as Row;
    const orgs = all('SELECT organization_id FROM meeting_organization WHERE meeting_id = ?', mid).map((r) =>
      String(r.organization_id),
    );
    const tops = all(
      `SELECT a.number, a.name, a.public, a.raw, c.paper_id
       FROM agenda_item a LEFT JOIN consultation c ON c.id = a.consultation_id
       WHERE a.meeting_id = ? ORDER BY a.ord`,
      mid,
    ).map((a) => {
      const raw = JSON.parse(String(a.raw)) as { resolutionFile?: { text?: string; accessUrl?: string } };
      if (a.paper_id) paperIds.add(String(a.paper_id));
      return {
        nr: s(a.number),
        name: cleanText(s(a.name), 300),
        oeffentlich: a.public === null ? null : a.public === 1,
        vorlage: s(a.paper_id),
        beschluss: cleanText(raw.resolutionFile?.text, 700),
      };
    });
    return {
      id: mid,
      k: String(m.body_id),
      name: s(m.name),
      start: s(m.start),
      ende: s(m.end),
      ort: s(m.location),
      status: s(m.state),
      abgesagt: m.cancelled === 1,
      gremien: orgs.map((o) => gremien.get(o) ?? o),
      tops,
      dateien: filesOf('meeting', mid),
    };
  });

  const vorlagen = [...paperIds].map((pid) => {
    const p = db.prepare('SELECT * FROM paper WHERE id = ?').get(pid) as Row;
    const raw = JSON.parse(String(p.raw)) as { mainFile?: { text?: string } };
    const beratung = all(
      `SELECT c.role, c.authoritative, c.organization_id, a.meeting_id, m.start, m.name AS sitzung
       FROM consultation c
       LEFT JOIN agenda_item a ON a.id = c.agenda_item_id
       LEFT JOIN meeting m ON m.id = a.meeting_id
       WHERE c.paper_id = ? ORDER BY m.start`,
      pid,
    ).map((c) => ({
      gremium: c.organization_id ? (gremien.get(String(c.organization_id)) ?? null) : null,
      rolle: s(c.role),
      entscheidend: c.authoritative === 1,
      sitzung: s(c.meeting_id),
      datum: s(c.start),
    }));
    return {
      id: pid,
      k: String(p.body_id),
      nr: s(p.reference),
      name: cleanText(s(p.name), 300),
      datum: s(p.date),
      art: s(p.paper_type),
      text: cleanText(raw.mainFile?.text, textLength),
      beratung,
      dateien: filesOf('paper', pid),
    };
  });

  return {
    erstellt: new Date().toISOString(),
    stichtag: now,
    quelle: {
      id: sourceId,
      name: s(source.name),
      ebene: s(source.ebene),
      landkreis: s(source.landkreis),
      system: s(source.system_url),
      abgleich: s(source.last_sync_at),
    },
    koerperschaften: bodies.map((b) => {
      const raw = JSON.parse(String(b.raw)) as { location?: { postalCode?: string; locality?: string } };
      return {
        id: String(b.id),
        name: String(b.name),
        art: art(String(b.name)),
        plz: raw.location?.postalCode ?? null,
        ort: raw.location?.locality ?? null,
      };
    }),
    sitzungen: sitzungen.sort((a, b) => String(a.start).localeCompare(String(b.start))),
    vorlagen: vorlagen.sort((a, b) => String(b.datum).localeCompare(String(a.datum))),
  };
}

export function writeSnapshot(db: DatabaseSync, sourceId: string, out: string, opts?: SnapshotOptions) {
  const snap = buildSnapshot(db, sourceId, opts);
  writeFileSync(out, JSON.stringify(snap));
  return snap;
}
