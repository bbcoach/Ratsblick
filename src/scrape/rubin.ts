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
import { berlinIso } from './sessionnet.js';

/**
 * Abgleich für more!rubin-Systeme ohne freigeschaltetes OParl über die JSON-Schnittstelle,
 * die die öffentliche Oberfläche selbst nutzt (`/api.php`, ohne Anmeldung, robots.txt erlaubt).
 * Geprüft an rockenhausen.gremien.info (VG Nordpfälzer Land), Stand 01.10.2026:
 *   ?id=organizations&action=bodies                                  Körperschaften
 *   ?id=calendar&action=get&from=JJJJ-MM&to=JJJJ-MM&view=list         Sitzungen
 *   ?id=meetings&action=get&meeting_id=<nummer>&with_agenda_item_documents=1   Tagesordnung, Vorlagen, Dokumente
 * Schreibt OParl-förmige Objekte über die gewohnten upsert-Funktionen.
 */

// ---------- Antworten der Schnittstelle (nur die genutzten Felder) ----------
export interface RubinBody {
  id: string;
  name: string;
}

export interface RubinRaum {
  Bezeichnung?: string;
  Strasse?: string;
  PLZ?: string;
  Ort?: string;
}

export interface RubinKalenderSitzung {
  id: number;
  nummer: string;
  datum: string; // JJJJ-MM-TT
  titel: string;
  beginn: string | null; // HH:MM:SS
  ende: string | null;
  gremium_1: string;
  event_type_id: number;
  fraktionssitzung: string;
  room?: RubinRaum | null;
  full_url?: string;
}

export interface RubinDokument {
  id: string;
  documentUrl: string;
  documentName?: string;
  documentType?: { name?: string; alias?: string };
  relationType?: string;
  name?: string;
  alias?: string;
}

export interface RubinVorlage {
  id: string;
  erstellungsdatum?: string;
  name?: string;
  alias?: string; // Drucksachennummer, z. B. „420/2026“
  type?: { name?: string; bezeichnung?: string };
}

export interface RubinTop {
  id: string;
  topnummer: string;
  title: string;
  status: number; // 1 = öffentlich, 2 = nicht öffentlich
  topart: string; // vl = Vorlage, at = allgemeiner Punkt, zt = Zusatzpunkt
  vorlagennummer: string;
  abstimmungstext?: string;
  documents?: RubinDokument[];
  submission?: RubinVorlage | null;
}

export interface RubinSitzung extends RubinKalenderSitzung {
  committees?: Array<{ Kuerzel: string; Bezeichnung: string; Koerperschaftsnummer: string }>;
  agenda_items?: RubinTop[];
}

// ---------- Hilfen ----------
/**
 * Körperschaftsnamen vereinheitlichen, damit sie zum Gemeindeverzeichnis passen:
 * „Ortsgemeinde Kirrweiler c/o Verbandsgemeinde Maikammer“ → „Ortsgemeinde Kirrweiler“,
 * „Verbandsgemeinde Maxdorf für OG Birkenheide“ → „Ortsgemeinde Birkenheide“.
 */
export function koerperschaftsName(name: string): string {
  const fuer = /^Verbandsgemeinde\s.+?\sfür\s+(?:OG|Ortsgemeinde)\s+(.+)$/.exec(name.trim());
  if (fuer) return `Ortsgemeinde ${fuer[1]!.trim()}`;
  return name.replace(/\s+c\/o\s+.*$/i, '').trim();
}

const zeit = (t: string | null | undefined) => (t && t !== '00:00:00' ? t.slice(0, 5) : null);

export function ort(r: RubinRaum | null | undefined): string | null {
  if (!r) return null;
  const adresse = [r.Strasse, [r.PLZ, r.Ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [r.Bezeichnung, adresse].filter(Boolean).join(', ') || null;
}

function datei(d: RubinDokument): OParlFile {
  // Die Adresse liefert das PDF direkt; „json=1“ gehört zur internen Vorschau und wird für Menschen entfernt
  const url = d.documentUrl.replace(/[&?]json=1/, '').replace(/[&?](platform|system)=ris/g, '');
  const name = (d.documentName ?? d.name ?? 'Dokument').replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim();
  return { id: d.documentUrl, name, accessUrl: url, downloadUrl: url, mimeType: 'application/pdf' } as OParlFile;
}

const einzeilig = (s: string | undefined | null) => (s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();

// ---------- Abgleich ----------
export interface RubinOptionen {
  monateZurueck?: number;
  monateVoraus?: number;
  /** Bereits gespeicherte Sitzungen, die länger als so viele Tage zurückliegen, nicht erneut laden. */
  festNachTagen?: number;
  alles?: boolean;
  log?: (msg: string) => void;
  now?: Date;
}

export async function syncRubinApi(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: RubinOptionen = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const base = new URL(source.url).origin + '/';
  const api = `${base}api.php`;
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };

  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('more!rubin (Schnittstelle der Oberfläche)', source.id);

  // 1. Körperschaften
  const bodies = await client.get<RubinBody[]>(`${api}?id=organizations&action=bodies`);
  const bodyId = (kuerzel: string) => `${base}#koerperschaft-${kuerzel}`;
  for (const b of bodies) {
    tx(db, () => upsertBody(db, source.id, { id: bodyId(b.id), name: koerperschaftsName(b.name), shortName: b.id } as never));
    stats.bodies++;
  }
  log(`  Körperschaften: ${bodies.length}`);

  // 2. Kalender (ein Abruf für das ganze Fenster)
  const monat = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const von = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - (opts.monateZurueck ?? 2), 1));
  const bis = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() + (opts.monateVoraus ?? 3), 1));
  const kal = await client.get<{ meetings?: RubinKalenderSitzung[] }>(
    `${api}?id=calendar&action=get&from=${monat(von)}&to=${monat(bis)}&view=list`,
  );
  const termine = (kal.meetings ?? []).filter((m) => m.event_type_id === 1 && m.fraktionssitzung !== '1');
  log(`  Kalender: ${termine.length} Sitzungen`);

  // 3. Sitzungen mit Tagesordnung
  const festVor = new Date(jetzt.getTime() - (opts.festNachTagen ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?');
  const gremien = new Set<string>();
  const vorlagen = new Map<string, { v: RubinVorlage; body: string; docs: RubinDokument[] }>();
  const sitzungId = (nummer: string) => `${base}meeting?id=${encodeURIComponent(nummer)}`;
  const vorlageId = (id: string) => `${base}submission?id=${encodeURIComponent(id)}`;

  for (const t of termine) {
    const meetingId = sitzungId(t.nummer);
    if (!opts.alles && t.datum < festVor && (vorhanden.get(meetingId) as { n: number }).n > 0) continue;
    let s: RubinSitzung;
    try {
      s = await client.get<RubinSitzung>(`${api}?id=meetings&action=get&meeting_id=${encodeURIComponent(t.nummer)}&with_agenda_item_documents=1`);
    } catch (err) {
      log(`    Sitzung ${t.nummer}: ${(err as Error).message}`);
      continue;
    }
    const gremium = s.committees?.[0];
    const koerperschaft = gremium?.Koerperschaftsnummer && bodies.some((b) => b.id === gremium.Koerperschaftsnummer)
      ? bodyId(gremium.Koerperschaftsnummer)
      : null;
    if (!koerperschaft) {
      log(`    Sitzung ${t.nummer}: Körperschaft unbekannt (${gremium?.Koerperschaftsnummer ?? '–'})`);
      continue;
    }
    const orgId = gremium ? `${base}#gremium-${gremium.Kuerzel}` : null;
    if (gremium && orgId && !gremien.has(orgId)) {
      gremien.add(orgId);
      tx(db, () => upsertOrganization(db, koerperschaft, { id: orgId, name: gremium.Bezeichnung, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }

    const tops = s.agenda_items ?? [];
    const agendaItem = tops.map((a, i) => {
      const v = a.topart === 'vl' && a.submission?.id ? a.submission : null;
      if (v) {
        const alt = vorlagen.get(v.id);
        const docs = (a.documents ?? []).filter((d) => !d.relationType || /Submission/.test(d.relationType));
        vorlagen.set(v.id, { v, body: koerperschaft, docs: alt?.docs.length ? alt.docs : docs });
      }
      return {
        id: `${meetingId}#top-${i + 1}`,
        number: a.topnummer,
        order: i + 1,
        name: einzeilig(a.title),
        public: a.status === 1 ? true : a.status === 2 ? false : undefined,
        result: einzeilig(a.abstimmungstext) || undefined,
        consultation: v ? `${vorlageId(v.id)}#${t.nummer}` : undefined,
        vorlage: v ? vorlageId(v.id) : null,
      };
    });
    // Dokumente zu Punkten ohne Vorlage (z. B. Anträge) hängen an der Sitzung
    const sitzungsDokumente = tops
      .filter((a) => !(a.topart === 'vl' && a.submission?.id))
      .flatMap((a) => a.documents ?? []);
    const vergangen = t.datum < jetzt.toISOString().slice(0, 10);
    const meeting = {
      id: meetingId,
      name: gremium?.Bezeichnung ?? einzeilig(t.titel),
      meetingState: vergangen ? 'durchgeführt' : tops.length ? 'eingeladen' : 'terminiert',
      start: berlinIso(t.datum, zeit(t.beginn) ?? '00:00'),
      end: zeit(t.ende) ? berlinIso(t.datum, zeit(t.ende)!) : undefined,
      location: ort(s.room ?? t.room) ? { description: ort(s.room ?? t.room)! } : undefined,
      organization: orgId ? [orgId] : [],
      agendaItem,
      auxiliaryFile: sitzungsDokumente.map(datei),
      quelle: 'more-rubin-api',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, koerperschaft, meeting, stats));
    stats.meetings++;
  }
  log(`    Sitzungen: ${stats.meetings} gelesen`);

  // 4. Vorlagen mit Beratungsfolge aus allen gespeicherten Tagesordnungen
  const auftritte = db.prepare(
    `SELECT a.id AS ai, a.meeting_id AS mid, mo.organization_id AS org
     FROM agenda_item a JOIN meeting m ON m.id = a.meeting_id
     LEFT JOIN meeting_organization mo ON mo.meeting_id = m.id
     WHERE a.consultation_id LIKE ? ORDER BY m.start`,
  );
  for (const [id, { v, body, docs }] of vorlagen) {
    const paperId = vorlageId(id);
    const rows = auftritte.all(`${paperId}#%`) as Array<{ ai: string; mid: string; org: string | null }>;
    const haupt = docs.find((d) => d.documentType?.alias === 'vl') ?? docs[0];
    const paper = {
      id: paperId,
      name: einzeilig(v.name) || undefined,
      reference: v.alias ?? undefined,
      date: v.erstellungsdatum?.slice(0, 10),
      paperType: v.type?.name ?? v.type?.bezeichnung ?? undefined,
      mainFile: haupt ? datei(haupt) : undefined,
      auxiliaryFile: docs.filter((d) => d !== haupt).map(datei),
      consultation: rows.map((r) => ({
        id: `${paperId}#${new URL(r.mid).searchParams.get('id') ?? r.ai}`,
        agendaItem: r.ai,
        meeting: r.mid,
        organization: r.org ? [r.org] : [],
      })),
      quelle: 'more-rubin-api',
    } as unknown as OParlPaper;
    tx(db, () => upsertPaper(db, body, paper, stats));
    stats.papers++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
