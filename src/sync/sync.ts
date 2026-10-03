import type { DatabaseSync } from 'node:sqlite';
import { tx } from '../db/index.js';
import type { OParlClient } from '../oparl/client.js';
import type {
  OParlBody,
  OParlFile,
  OParlMeeting,
  OParlOrganization,
  OParlPaper,
  OParlSystem,
} from '../oparl/types.js';

export interface SourceRecord {
  id: string;
  name: string;
  ebene?: string | null;
  landkreis?: string | null;
  url: string;
  status?: string | null;
  /** Amtlicher Schlüssel des Gebiets der Quelle (data/gebiete-rlp.json). */
  gebiet?: string;
  /** Zugang: OParl (Standard) oder ein Scraper für Systeme ohne OParl. */
  typ?: 'oparl' | 'sessionnet' | 'rubin-api' | 'allris' | 'allris-net' | 'regisafe' | 'ics' | 'edith' | 'protokolle';
  /** Nur SessionNet: Dateiendung der Seiten (asp oder php). */
  endung?: 'asp' | 'php';
  /** Größerer Mindestabstand zwischen Anfragen an diesen Server (ms). */
  intervallMs?: number;
  /** Nur SessionNet: Kalender je Mandant (`__cpanr`) lesen, z. B. Ortsgemeinden im System der VG. */
  mandanten?: boolean;
  /** Nur `protokolle`: weitere Listenseiten (die Quell-URL ist die erste). */
  seiten?: string[];
}

export interface SyncOptions {
  /** Ignoriert den gespeicherten Stand und lädt alles neu. */
  full?: boolean;
  log?: (msg: string) => void;
}

export interface SyncStats {
  bodies: number;
  organizations: number;
  meetings: number;
  agendaItems: number;
  papers: number;
  consultations: number;
  files: number;
}

const b = (v: boolean | undefined) => (v ? 1 : 0);
const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const j = (v: unknown) => JSON.stringify(v);

/**
 * Entfernt alle gespeicherten Daten einer Quelle (Körperschaften samt Sitzungen, Vorlagen, Dateien).
 * Nötig, wenn eine Quelle auf einen anderen Zugang umgestellt wird (andere IDs), damit nichts doppelt erscheint.
 */
export function leereQuelle(db: DatabaseSync, sourceId: string): number {
  const bodies = (db.prepare('SELECT id FROM body WHERE source_id = ?').all(sourceId) as Array<{ id: string }>).map((b) => b.id);
  if (!bodies.length) return 0;
  const imBody = `IN (SELECT id FROM body WHERE source_id = ?)`;
  tx(db, () => {
    db.prepare(`DELETE FROM file_link WHERE (owner_type = 'meeting' AND owner_id IN (SELECT id FROM meeting WHERE body_id ${imBody}))
      OR (owner_type = 'paper' AND owner_id IN (SELECT id FROM paper WHERE body_id ${imBody}))`).run(sourceId, sourceId);
    db.prepare(`DELETE FROM agenda_item WHERE meeting_id IN (SELECT id FROM meeting WHERE body_id ${imBody})`).run(sourceId);
    db.prepare(`DELETE FROM meeting_organization WHERE meeting_id IN (SELECT id FROM meeting WHERE body_id ${imBody})`).run(sourceId);
    db.prepare(`DELETE FROM consultation WHERE paper_id IN (SELECT id FROM paper WHERE body_id ${imBody})`).run(sourceId);
    for (const t of ['meeting', 'paper', 'file', 'organization']) db.prepare(`DELETE FROM ${t} WHERE body_id ${imBody}`).run(sourceId);
    db.prepare(`DELETE FROM sync_state WHERE body_id ${imBody}`).run(sourceId);
    db.prepare('DELETE FROM body WHERE source_id = ?').run(sourceId);
  });
  return bodies.length;
}

/** Gespeicherte Adresse einer Quelle (null, wenn noch nie abgeglichen). */
export function gespeicherteAdresse(db: DatabaseSync, sourceId: string): string | null {
  return (db.prepare('SELECT system_url FROM source WHERE id = ?').get(sourceId) as { system_url: string } | undefined)?.system_url ?? null;
}

export function upsertSource(db: DatabaseSync, s: SourceRecord): void {
  db.prepare(
    `INSERT INTO source (id, name, ebene, landkreis, system_url, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, ebene = excluded.ebene,
       landkreis = excluded.landkreis, system_url = excluded.system_url, status = excluded.status`,
  ).run(s.id, s.name, n(s.ebene ?? undefined), n(s.landkreis ?? undefined), s.url, n(s.status ?? undefined));
}

function locationText(loc: OParlMeeting['location']): string | null {
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  return (
    loc.description ??
    ([loc.streetAddress, loc.room, loc.postalCode, loc.locality].filter(Boolean).join(', ') || null)
  );
}

function upsertFile(
  db: DatabaseSync,
  bodyId: string,
  f: OParlFile,
  ownerType: 'paper' | 'meeting',
  ownerId: string,
  role: string,
  stats: SyncStats,
): void {
  if (!f?.id) return;
  db.prepare(
    `INSERT INTO file (id, body_id, name, file_name, mime_type, date, size, access_url, download_url, modified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, file_name = excluded.file_name,
       mime_type = excluded.mime_type, date = excluded.date, size = excluded.size,
       access_url = excluded.access_url, download_url = excluded.download_url,
       modified = excluded.modified, raw = excluded.raw`,
  ).run(
    f.id, bodyId, n(f.name), n(f.fileName), n(f.mimeType), n(f.date), n(f.size),
    n(f.accessUrl), n(f.downloadUrl), n(f.modified), j(f),
  );
  db.prepare(
    `INSERT OR IGNORE INTO file_link (file_id, owner_type, owner_id, role) VALUES (?, ?, ?, ?)`,
  ).run(f.id, ownerType, ownerId, role);
  stats.files++;
}

export function upsertBody(db: DatabaseSync, sourceId: string, body: OParlBody): void {
  db.prepare(
    `INSERT INTO body (id, source_id, name, short_name, ags, website, modified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, name = excluded.name,
       short_name = excluded.short_name, ags = excluded.ags, website = excluded.website,
       modified = excluded.modified, raw = excluded.raw`,
  ).run(body.id, sourceId, n(body.name), n(body.shortName), n(body.ags), n(body.website), n(body.modified), j(body));
}

export function upsertOrganization(db: DatabaseSync, bodyId: string, o: OParlOrganization): void {
  db.prepare(
    `INSERT INTO organization (id, body_id, name, short_name, organization_type, classification,
       start_date, end_date, deleted, modified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body_id = excluded.body_id, name = excluded.name,
       short_name = excluded.short_name, organization_type = excluded.organization_type,
       classification = excluded.classification, start_date = excluded.start_date,
       end_date = excluded.end_date, deleted = excluded.deleted, modified = excluded.modified, raw = excluded.raw`,
  ).run(
    o.id, bodyId, n(o.name), n(o.shortName), n(o.organizationType), n(o.classification),
    n(o.startDate), n(o.endDate), b(o.deleted), n(o.modified), j(o),
  );
}

export function upsertMeeting(db: DatabaseSync, bodyId: string, m: OParlMeeting, stats: SyncStats): void {
  db.prepare(
    `INSERT INTO meeting (id, body_id, name, state, cancelled, start, end, location, deleted, modified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body_id = excluded.body_id, name = excluded.name, state = excluded.state,
       cancelled = excluded.cancelled, start = excluded.start, end = excluded.end,
       location = excluded.location, deleted = excluded.deleted, modified = excluded.modified, raw = excluded.raw`,
  ).run(
    m.id, bodyId, n(m.name), n(m.meetingState), b(m.cancelled), n(m.start), n(m.end),
    locationText(m.location), b(m.deleted), n(m.modified), j(m),
  );

  // Eingebettete Teile vollständig ersetzen: Punkte können entfallen oder umnummeriert werden.
  db.prepare('DELETE FROM meeting_organization WHERE meeting_id = ?').run(m.id);
  for (const orgId of m.organization ?? []) {
    db.prepare('INSERT OR IGNORE INTO meeting_organization (meeting_id, organization_id) VALUES (?, ?)').run(m.id, orgId);
  }

  db.prepare('DELETE FROM agenda_item WHERE meeting_id = ?').run(m.id);
  (m.agendaItem ?? []).forEach((a, i) => {
    const id = a.id ?? `${m.id}#top-${i + 1}`;
    db.prepare(
      `INSERT INTO agenda_item (id, meeting_id, number, ord, name, public, result, resolution_text, consultation_id, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET meeting_id = excluded.meeting_id, number = excluded.number, ord = excluded.ord,
         name = excluded.name, public = excluded.public, result = excluded.result,
         resolution_text = excluded.resolution_text, consultation_id = excluded.consultation_id, raw = excluded.raw`,
    ).run(
      id, m.id, n(a.number), a.order ?? i + 1, n(a.name),
      a.public === undefined ? null : b(a.public), n(a.result), n(a.resolutionText), n(a.consultation), j(a),
    );
    stats.agendaItems++;
  });

  db.prepare(`DELETE FROM file_link WHERE owner_type = 'meeting' AND owner_id = ?`).run(m.id);
  if (m.invitation) upsertFile(db, bodyId, m.invitation, 'meeting', m.id, 'invitation', stats);
  if (m.resultsProtocol) upsertFile(db, bodyId, m.resultsProtocol, 'meeting', m.id, 'resultsProtocol', stats);
  if (m.verbatimProtocol) upsertFile(db, bodyId, m.verbatimProtocol, 'meeting', m.id, 'verbatimProtocol', stats);
  for (const f of m.auxiliaryFile ?? []) upsertFile(db, bodyId, f, 'meeting', m.id, 'auxiliary', stats);
}

export function upsertPaper(db: DatabaseSync, bodyId: string, p: OParlPaper, stats: SyncStats): void {
  db.prepare(
    `INSERT INTO paper (id, body_id, name, reference, date, paper_type, main_file_id, deleted, modified, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET body_id = excluded.body_id, name = excluded.name, reference = excluded.reference,
       date = excluded.date, paper_type = excluded.paper_type, main_file_id = excluded.main_file_id,
       deleted = excluded.deleted, modified = excluded.modified, raw = excluded.raw`,
  ).run(
    p.id, bodyId, n(p.name), n(p.reference), n(p.date), n(p.paperType), n(p.mainFile?.id),
    b(p.deleted), n(p.modified), j(p),
  );

  db.prepare('DELETE FROM consultation WHERE paper_id = ?').run(p.id);
  (p.consultation ?? []).forEach((c, i) => {
    const id = c.id ?? `${p.id}#beratung-${i + 1}`;
    db.prepare(
      `INSERT INTO consultation (id, paper_id, meeting_id, agenda_item_id, organization_id, authoritative, role, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET paper_id = excluded.paper_id, meeting_id = excluded.meeting_id,
         agenda_item_id = excluded.agenda_item_id, organization_id = excluded.organization_id,
         authoritative = excluded.authoritative, role = excluded.role, raw = excluded.raw`,
    ).run(
      id, p.id, n(c.meeting), n(c.agendaItem), n(c.organization?.[0]),
      c.authoritative === undefined ? null : b(c.authoritative), n(c.role), j(c),
    );
    stats.consultations++;
  });

  db.prepare(`DELETE FROM file_link WHERE owner_type = 'paper' AND owner_id = ?`).run(p.id);
  if (p.mainFile) upsertFile(db, bodyId, p.mainFile, 'paper', p.id, 'main', stats);
  for (const f of p.auxiliaryFile ?? []) upsertFile(db, bodyId, f, 'paper', p.id, 'auxiliary', stats);
}

function getSince(db: DatabaseSync, bodyId: string, list: string): string | undefined {
  const row = db.prepare('SELECT modified_since FROM sync_state WHERE body_id = ? AND list = ?').get(bodyId, list) as
    | { modified_since: string }
    | undefined;
  return row?.modified_since;
}

function setSince(db: DatabaseSync, bodyId: string, list: string, value: string): void {
  db.prepare(
    `INSERT INTO sync_state (body_id, list, modified_since) VALUES (?, ?, ?)
     ON CONFLICT(body_id, list) DO UPDATE SET modified_since = excluded.modified_since`,
  ).run(bodyId, list, value);
}

/**
 * Gleicht eine Quelle ab: System → Körperschaften → Gremien, Sitzungen, Vorlagen.
 * Inkrementell über `modified_since`; der neue Stand wird erst nach vollständigem Durchlauf gespeichert,
 * damit ein Abbruch nichts überspringt.
 */
export async function syncSource(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: SyncOptions = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };

  upsertSource(db, source);
  const system = await client.get<OParlSystem>(source.url);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = ? WHERE id = ?').run(
    n(system.vendor ?? system.product), n(system.oparlVersion), source.id,
  );
  if (!system.body) throw new Error(`System ${source.url} nennt keine Körperschaftsliste (body)`);

  for await (const body of client.paginate<OParlBody>(system.body)) {
    if (!body?.id) continue;
    tx(db, () => upsertBody(db, source.id, body));
    stats.bodies++;
    log(`  Körperschaft: ${body.name ?? body.id}`);

    const lists: Array<[name: 'organization' | 'meeting' | 'paper', url: string | undefined]> = [
      ['organization', body.organization],
      ['meeting', body.meeting],
      ['paper', body.paper],
    ];
    for (const [list, url] of lists) {
      if (!url) continue;
      const since = opts.full ? undefined : getSince(db, body.id, list);
      const startedAt = new Date().toISOString();
      let count = 0;
      let truncated = false;
      const onTruncated = () => (truncated = true);
      for await (const item of client.paginate<{ id: string }>(url, { modifiedSince: since, onTruncated })) {
        if (!item?.id) continue;
        tx(db, () => {
          if (list === 'organization') upsertOrganization(db, body.id, item as OParlOrganization);
          else if (list === 'meeting') upsertMeeting(db, body.id, item as OParlMeeting, stats);
          else upsertPaper(db, body.id, item as OParlPaper, stats);
        });
        count++;
      }
      if (list === 'organization') stats.organizations += count;
      else if (list === 'meeting') stats.meetings += count;
      else stats.papers += count;
      // Nur nach vollständigem Lesen als Stand merken, sonst überspringt der nächste Lauf den Rest.
      if (!truncated) setSince(db, body.id, list, startedAt);
      log(`    ${list}: ${count}${since ? ` (geändert seit ${since})` : ''}${truncated ? ' (abgeschnitten)' : ''}`);
    }
  }

  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
