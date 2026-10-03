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
  seite?: boolean;
  /** Das System liefert die Datei als Download (Content-Disposition: attachment) – nicht im Browser anzeigbar. */
  dl?: boolean;
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

/** Schneidet den Formularkopf einer Vorlage ab (Drucksache-Nr., Beratungsfolge, Betreff), der Titel steht ohnehin oben. */
export function ohneKopf(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  const i = text.search(/Sachverhalt\s*(\/\s*Begründung)?\s*:|Inhalt der Mitteilung\s*:/);
  return i > 0 ? text.slice(i) : text;
}

/**
 * Seite des Objekts im Original-Ratsinformationssystem (für Menschen), soweit bekannt:
 * `web` aus OParl; bei Scrapern ist die ID die Seitenadresse; more!rubin-Sitzungen unter `/meeting?id=<Nummer>`.
 * null, wenn es keine verlässliche Einzelseite gibt (dann verweist die App auf die Startseite des RIS).
 */
export function webSeite(id: string, raw: { web?: unknown }, art: 'sitzung' | 'vorlage'): string | null {
  if (typeof raw.web === 'string' && /^https?:\/\//.test(raw.web)) return raw.web;
  if (!/^https?:\/\//.test(id) || id.includes('#')) return null;
  const u = new URL(id);
  const rubin = u.hostname.endsWith('.gremien.info');
  if (/\/oparl\//i.test(u.pathname)) {
    if (rubin && art === 'sitzung') return `${u.origin}/meeting?id=${encodeURIComponent(u.pathname.split('/').pop()!.replace(/^ni_/, ''))}`;
    return null;
  }
  if (rubin && art === 'vorlage') return null; // more!rubin-Vorlagen haben keine verlässliche Einzelseite
  // ALLRIS 4 (Trier, Bingen): ohne refresh=false leitet die Seite teils auf die Anmeldung um
  if (/\/(to010|vo020)$/.test(u.pathname) && !u.searchParams.has('refresh')) return `${id}&refresh=false`;
  return id;
}

/**
 * Dokument-Links: more!rubin liefert PDFs von `/api.php?document_type_id=…` nur dann im Browser (inline), wenn `inline=1`
 * dabeisteht – sonst kommt `Content-Disposition: attachment` und Android lädt die Datei nur herunter (gemessen 03.10.2026,
 * Emmelshausen/Donnersberg: attachment → mit `&inline=1` inline). Für alle more!rubin-Quellen anwenden.
 */
export function dokumentUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.gremien.info') && u.pathname === '/api.php' && u.searchParams.has('document_type_id') && !u.searchParams.has('inline')) {
      return `${url}${url.includes('?') ? '&' : '?'}inline=1`;
    }
  } catch { /* keine gültige Adresse: unverändert lassen */ }
  return url;
}

/** SessionNet liefert `getfile.asp|php` immer als Download (gemessen in Kusel-Altenglan und Koblenz); `inline` ändert daran nichts. */
export function istDownload(url: string | null): boolean {
  return !!url && /\/getfile\.(asp|php)\?/.test(url);
}

/**
 * SessionNet: Sitzungen ohne veröffentlichte Tagesordnung und ohne Unterlagen haben im RIS keine Einzelseite
 * (Kaiserslautern: „Zum Öffnen des Vorgangs fehlt die Berechtigung“, Fehlercode 1104; Landau leitet um). Dann verlinken wir
 * stattdessen den Kalender des Sitzungsmonats im selben System. Andere Systeme: null (Einzelseite bleibt).
 */
export function sessionnetKalender(web: string, start: string): string | null {
  const m = /^(https?:\/\/.*\/)si005[67]\.(asp|php)\?/.exec(web);
  const t = /^(\d{4})-(\d{2})/.exec(start);
  if (!m || !t) return null;
  return `${m[1]}si0040.${m[2]}?__cjahr=${t[1]}&__cmonat=${Number(t[2])}&__canz=1&__cselect=0`;
}

export function art(name: string): string {
  if (name.startsWith('Ortsgemeinde')) return 'Ortsgemeinde';
  if (name.startsWith('Ortsbezirk')) return 'Ortsbezirk';
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
      `SELECT f.name, f.access_url, f.mime_type, l.role FROM file_link l JOIN file f ON f.id = l.file_id
       WHERE l.owner_type = ? AND l.owner_id = ?
       ORDER BY CASE l.role WHEN 'main' THEN 0 WHEN 'invitation' THEN 1 WHEN 'resultsProtocol' THEN 2 ELSE 3 END, f.name`,
      ownerType,
      ownerId,
    ).map((f) => ({
      name: String(f.name ?? 'Dokument'),
      rolle: String(f.role),
      url: dokumentUrl(s(f.access_url)),
      ...(istDownload(s(f.access_url)) ? { dl: true } : {}),
      // Verweis auf eine Webseite statt auf ein PDF (Kalenderexport: Tagesordnung im RIS)
      ...(f.mime_type === 'text/html' ? { seite: true } : {}),
    }));

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
      const raw = JSON.parse(String(a.raw)) as { resolutionFile?: { text?: string; accessUrl?: string }; result?: string };
      if (a.paper_id) paperIds.add(String(a.paper_id));
      return {
        nr: s(a.number),
        name: cleanText(s(a.name), 300),
        oeffentlich: a.public === null ? null : a.public === 1,
        vorlage: s(a.paper_id),
        beschluss: cleanText(raw.resolutionFile?.text ?? raw.result, 700),
      };
    });
    const dateien = filesOf('meeting', mid);
    const einzelseite = webSeite(mid, JSON.parse(String(m.raw)) as { web?: unknown }, 'sitzung');
    const kalender = einzelseite && tops.length === 0 && dateien.length === 0 ? sessionnetKalender(einzelseite, String(m.start ?? '')) : null;
    return {
      id: mid,
      k: String(m.body_id),
      web: kalender ?? einzelseite,
      ...(kalender ? { webKalender: true } : {}),
      name: s(m.name),
      start: s(m.start),
      ende: s(m.end),
      ort: s(m.location),
      status: s(m.state),
      abgesagt: m.cancelled === 1,
      gremien: orgs.map((o) => gremien.get(o) ?? o),
      tops,
      dateien,
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
      web: webSeite(pid, raw as { web?: unknown }, 'vorlage'),
      nr: s(p.reference),
      name: cleanText(s(p.name), 300),
      datum: s(p.date),
      art: s(p.paper_type),
      text: cleanText(ohneKopf(raw.mainFile?.text), textLength),
      beratung,
      dateien: filesOf('paper', pid),
    };
  });

  // Manche Systeme enthalten mehrere Verbandsgemeinden (z. B. vor und nach einer Fusion): die aktuellste gilt.
  const vg = db
    .prepare(
      `SELECT b.id FROM body b LEFT JOIN meeting m ON m.body_id = b.id
       WHERE b.source_id = ? AND b.name LIKE 'Verbandsgemeinde %'
       GROUP BY b.id ORDER BY MAX(m.start) DESC LIMIT 1`,
    )
    .get(sourceId) as Row | undefined;

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
    vg: vg ? String(vg.id) : null,
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
