import type { DatabaseSync } from 'node:sqlite';
import { OParlClient, OParlHttpError, OParlServerError } from '../oparl/client.js';
import type { OParlBody, OParlListResponse, OParlSystem } from '../oparl/types.js';
import { upsertSource, type SourceRecord } from './sync.js';

export type ProbeStatus = 'aktiv' | 'nicht freigeschaltet' | 'teilweise' | 'nicht erreichbar';

export interface ProbeResult {
  id: string;
  name: string;
  status: ProbeStatus;
  detail: string;
  vendor?: string;
  oparlVersion?: string;
  bodies?: number;
}

/**
 * Prüft, ob eine Schnittstelle antwortet UND ob die Körperschaftsliste lesbar ist.
 * Beides getrennt, weil manche Systeme zwar ein System-Objekt liefern, die Liste aber nicht.
 */
export async function probeSource(client: OParlClient, s: SourceRecord): Promise<ProbeResult> {
  const base = { id: s.id, name: s.name };
  let system: OParlSystem;
  try {
    system = await client.get<OParlSystem>(s.url);
  } catch (err) {
    if (err instanceof OParlServerError) {
      const inactive = /not active/i.test(err.message);
      return { ...base, status: inactive ? 'nicht freigeschaltet' : 'nicht erreichbar', detail: err.message };
    }
    if (err instanceof OParlHttpError) {
      return { ...base, status: 'nicht erreichbar', detail: err.message };
    }
    throw err;
  }

  const meta = {
    vendor: system.vendor ?? system.product,
    oparlVersion: system.oparlVersion?.replace(/^https?:\/\/schema\.oparl\.org\//, '').replace(/\/$/, ''),
  };
  if (!system.body) {
    return { ...base, ...meta, status: 'teilweise', detail: 'System ohne Körperschaftsliste' };
  }
  try {
    const page = await client.get<OParlListResponse<OParlBody>>(system.body);
    const bodies = page.data?.length ?? 0;
    return { ...base, ...meta, bodies, status: 'aktiv', detail: `${bodies} Körperschaft(en) auf Seite 1` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, ...meta, status: 'teilweise', detail: `System ok, Körperschaftsliste fehlerhaft: ${msg}` };
  }
}

export function saveProbe(db: DatabaseSync, s: SourceRecord, r: ProbeResult): void {
  upsertSource(db, s);
  db.prepare(
    `UPDATE source SET last_probe_at = ?, last_probe_result = ?, vendor = COALESCE(?, vendor),
       oparl_version = COALESCE(?, oparl_version) WHERE id = ?`,
  ).run(new Date().toISOString(), `${r.status}: ${r.detail}`, r.vendor ?? null, r.oparlVersion ?? null, s.id);
}
