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
import { berlinIso, text } from './sessionnet.js';

/**
 * Scraper für das regisafe-RIS (Liferay-Portal von comundus, `<name>.ris-portal.de`), geprüft an
 * kirchheimbolanden.ris-portal.de (02.10.2026). Alles ohne Anmeldung:
 * - `sitzungen`: Seite mit allen Gremien in der Filterliste (Reihenfolge nach Körperschaft gruppiert)
 * - `sitzungen?p_p_id=RisSitzung&p_p_lifecycle=2&…&_RisSitzung_resource=loadSessions&_RisSitzung_year=…&_RisSitzung_month=…`
 *   Kalender als JSON (Monat ab 0)
 * - `web/guest/sitzungen?sitzungId=…`: Sitzung mit Tagesordnung und Dokumenten (Sitzungsvorlage je TOP, mit Nummer)
 * Vorlagen haben keine eigene Seite; sie werden aus dem Dokument „Sitzungsvorlage (JJJJ/NNNN)“ am TOP gebildet.
 * Ein System enthält VG, Stadt und Ortsgemeinden – die Körperschaft ergibt sich aus dem Gremiumsnamen.
 */

export interface RegisafeGremium {
  id: string;
  name: string;
  /** Ort der Körperschaft oder null für die Verbandsgemeinde */
  ort: string | null;
}

export interface RegisafeTermin {
  sitzungId: number;
  start: string; // JJJJ-MM-TTTHH:MM (Ortszeit)
  location?: string | null;
  text?: string;
}

export interface RegisafeDokument {
  id: string;
  url: string;
  typ: string; // Sitzungsvorlage, Sitzungsunterlage, Beschluss, Niederschriftsauszug, Sitzungsbekanntmachung …
  titel: string;
}

export interface RegisafeTop {
  id: string;
  nr: string;
  betreff: string;
  oeffentlich: boolean;
  dokumente: RegisafeDokument[];
}

export interface RegisafeSitzung {
  titel: string | null;
  tops: RegisafeTop[];
  dokumente: RegisafeDokument[];
}

const ohneZeitraum = (n: string) => n.replace(/\s+bis\s+\d{2}\/\d{4}\s*$/, '').replace(/\s+/g, ' ').trim();

/**
 * Gremien aus der Filterliste. Ort = Gemeinde, auf deren Namen der Gremiumsname endet; Gremien mit „Verbandsgemeinde“
 * gehören zur VG; Gremien ohne Ortsangabe gehören zur Körperschaft des vorangehenden Eintrags (Liste ist gruppiert).
 */
export function parseGremien(html: string): RegisafeGremium[] {
  const roh = [...html.matchAll(/<label for="_RisSitzung_Gremium_(\d+)">([^<]*)<\/label>/g)].map((m) => ({
    id: m[1]!,
    name: ohneZeitraum(text(m[2])),
  }));
  const orte = [...new Set(roh.map((g) => /^(?:Gemeinderat|Stadtrat)\s+(.+)$/.exec(g.name)?.[1]).filter((o): o is string => !!o))]
    .sort((a, b) => b.length - a.length);
  let zuletzt: string | null = null;
  return roh.map((g) => {
    let ort: string | null;
    if (/verbandsgemeinde/i.test(g.name)) ort = null;
    else ort = orte.find((o) => g.name === o || g.name.endsWith(` ${o}`)) ?? zuletzt;
    zuletzt = ort;
    return { ...g, ort };
  });
}

/** Gremiumsname aus dem Kalendereintrag (Badge in der Listenansicht). */
export function gremiumAusTermin(t: RegisafeTermin): string | null {
  const m = /rp-gremium-badge mbsc-hide-in-calendar'>([^<]*)</.exec(t.text ?? '');
  return m ? ohneZeitraum(text(m[1])) : null;
}

const attr = (s: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(s);
  return m ? m[1]!.replace(/&amp;/g, '&') : null;
};

function dokumenteIn(html: string): RegisafeDokument[] {
  const out: RegisafeDokument[] = [];
  for (const m of html.matchAll(/<button class="document-button"([\s\S]*?)<\/button>/g)) {
    const id = attr(m[1]!, 'data-docid');
    const url = attr(m[1]!, 'data-href');
    if (!id || !url) continue;
    const titel = text(/<span class="d-none doc-title">([\s\S]*?)<\/span>/.exec(m[1]!)?.[1]) || 'Dokument';
    out.push({ id, url: url.replace(':443/', '/'), typ: attr(m[1]!, 'data-type') ?? '', titel });
  }
  return out;
}

export function parseSitzung(html: string): RegisafeSitzung {
  const titel = /<h2 class="h1">([\s\S]*?)<\/h2>/.exec(html);
  const metaAb = html.indexOf('<div class="rp-meta-data');
  const tagesordnung = metaAb > 0 ? html.slice(0, metaAb) : html;
  const teile = [...tagesordnung.matchAll(/<h3 class="h4 accordion-list-header">([^<]*)<\/h3>/g)].map((m) => ({
    pos: m.index!,
    oeffentlich: !/nicht/i.test(m[1]!),
  }));
  const tops: RegisafeTop[] = [];
  const starts = [...tagesordnung.matchAll(/<li class="rp-lis-item"/g)].map((m) => m.index!);
  starts.forEach((pos, i) => {
    const stueck = tagesordnung.slice(pos, starts[i + 1] ?? tagesordnung.length);
    const id = /id="top_id_(\d+)"/.exec(stueck)?.[1];
    const kopf = /<div class="top-item-content">\s*<p>\s*<span>([^<]*)<\/span>\s*<span>([\s\S]*?)<\/span>/.exec(stueck);
    if (!id || !kopf) return;
    const teil = teile.filter((t) => t.pos < pos).at(-1);
    tops.push({
      id,
      nr: text(kopf[1]).replace(/\.$/, ''),
      betreff: text(kopf[2]),
      oeffentlich: teil?.oeffentlich ?? true,
      dokumente: dokumenteIn(stueck),
    });
  });
  const anTops = new Set(tops.flatMap((t) => t.dokumente.map((d) => d.id)));
  const sitzungsDokumente = new Map<string, RegisafeDokument>();
  for (const d of dokumenteIn(html)) if (!anTops.has(d.id) && !sitzungsDokumente.has(d.id)) sitzungsDokumente.set(d.id, d);
  return { titel: titel ? text(titel[1]) : null, tops, dokumente: [...sitzungsDokumente.values()] };
}

/** Vorlagennummer aus „Sitzungsvorlage (2026/0023)“. */
export function vorlagenNummer(d: RegisafeDokument): string | null {
  if (!/vorlage/i.test(d.typ)) return null;
  return /\(([^()]*\d[^()]*)\)\s*$/.exec(d.titel)?.[1]?.trim() ?? null;
}

// ---------- Abgleich ----------
export interface RegisafeOptionen {
  monateZurueck?: number;
  monateVoraus?: number;
  festNachTagen?: number;
  alles?: boolean;
  log?: (msg: string) => void;
  now?: Date;
}

function datei(d: RegisafeDokument): OParlFile {
  return { id: d.url, name: d.titel, accessUrl: d.url, downloadUrl: d.url, mimeType: 'application/pdf' } as OParlFile;
}

export async function syncRegisafe(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: RegisafeOptionen = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const base = new URL(source.url).origin + '/';
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };

  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('regisafe (Scraper)', source.id);

  // 1. Gremien und Körperschaften
  const gremien = parseGremien(await client.getText(`${base}sitzungen`));
  const stadtorte = new Set(gremien.filter((g) => g.name.startsWith('Stadtrat ')).map((g) => g.ort));
  const vgName = source.name.replace(/^VG /, 'Verbandsgemeinde ');
  const bodyVon = (ort: string | null) => (ort ? `${base}#koerperschaft-${encodeURIComponent(ort)}` : `${base}#koerperschaft`);
  const angelegt = new Set<string>();
  const koerperschaft = (ort: string | null) => {
    const id = bodyVon(ort);
    if (!angelegt.has(id)) {
      angelegt.add(id);
      const name = ort ? `${stadtorte.has(ort) ? 'Stadt' : 'Ortsgemeinde'} ${ort}` : vgName;
      tx(db, () => upsertBody(db, source.id, { id, name, shortName: ort ?? source.id } as never));
      stats.bodies++;
    }
    return id;
  };
  koerperschaft(null);
  const gremiumNachName = new Map(gremien.map((g) => [g.name, g]));
  log(`  Gremien: ${gremien.length}`);

  // 2. Kalender (JSON, Monat ab 0)
  const termine = new Map<number, RegisafeTermin>();
  const von = opts.monateZurueck ?? 2;
  const bis = opts.monateVoraus ?? 3;
  for (let i = -von; i <= bis; i++) {
    const d = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() + i, 1));
    const url =
      `${base}sitzungen?p_p_id=RisSitzung&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage` +
      `&_RisSitzung_resource=loadSessions&_RisSitzung_year=${d.getUTCFullYear()}&_RisSitzung_month=${d.getUTCMonth()}` +
      `&_RisSitzung_day=1&_RisSitzung_filterGremiumIds=&_RisSitzung_filterTypeOfRisCalendarItems=&_RisSitzung_viewMode=month`;
    try {
      for (const t of await client.get<RegisafeTermin[]>(url)) if (t.sitzungId) termine.set(t.sitzungId, t);
    } catch (err) {
      log(`    Kalender ${d.getUTCMonth() + 1}/${d.getUTCFullYear()}: ${(err as Error).message}`);
    }
  }
  log(`  Kalender: ${termine.size} Sitzungen in ${von + bis + 1} Monaten`);

  // 3. Sitzungen
  const festVor = new Date(jetzt.getTime() - (opts.festNachTagen ?? 14) * 86_400_000).toISOString();
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?');
  const orgs = new Set<string>();
  const vorlagen = new Map<string, { name: string; body: string; haupt: RegisafeDokument; weitere: RegisafeDokument[] }>();
  const vorlageId = (nr: string) => `${base}#vorlage-${nr}`;
  for (const t of termine.values()) {
    const meetingId = `${base}web/guest/sitzungen?sitzungId=${t.sitzungId}`;
    const [datum, zeit] = t.start.split('T');
    const start = berlinIso(datum!, zeit?.slice(0, 5) || '00:00');
    if (!opts.alles && start < festVor && (vorhanden.get(meetingId) as { n: number }).n > 0) continue;
    let s: RegisafeSitzung;
    try {
      s = parseSitzung(await client.getText(meetingId));
    } catch (err) {
      log(`    Sitzung ${t.sitzungId}: ${(err as Error).message}`);
      continue;
    }
    const gName = gremiumAusTermin(t) ?? /^Sitzung\s+(.+?)\s+am\s+\d/.exec(s.titel ?? '')?.[1] ?? null;
    const g = gName ? gremiumNachName.get(gName) : undefined;
    const body = koerperschaft(g ? g.ort : null);
    const orgId = g ? `${base}gremien?gremiumId=${g.id}` : null;
    if (g && orgId && !orgs.has(orgId)) {
      orgs.add(orgId);
      tx(db, () => upsertOrganization(db, body, { id: orgId, name: g.name, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }
    const sitzungsDateien: RegisafeDokument[] = [...s.dokumente];
    const agendaItem = s.tops.map((top, i) => {
      const sv = top.dokumente.find((d) => vorlagenNummer(d));
      const nr = sv ? vorlagenNummer(sv)! : null;
      if (sv && nr) {
        const alt = vorlagen.get(nr);
        const weitere = top.dokumente.filter((d) => d !== sv);
        vorlagen.set(nr, { name: top.betreff, body, haupt: sv, weitere: [...(alt?.weitere ?? []), ...weitere] });
      } else {
        sitzungsDateien.push(...top.dokumente);
      }
      return {
        id: `${meetingId}#top-${top.id}`,
        number: top.nr,
        order: i + 1,
        name: top.betreff,
        public: top.oeffentlich,
        consultation: nr ? `${vorlageId(nr)}#${t.sitzungId}` : undefined,
        vorlage: nr ? vorlageId(nr) : null,
      };
    });
    const einladung = sitzungsDateien.find((d) => /bekanntmachung|einladung/i.test(d.typ + d.titel));
    const protokoll = sitzungsDateien.find((d) => /niederschrift|protokoll/i.test(d.typ + d.titel));
    const meeting = {
      id: meetingId,
      name: g?.name ?? gName ?? s.titel,
      meetingState: start < jetzt.toISOString() ? 'durchgeführt' : 'eingeladen',
      start,
      location: t.location ? { description: t.location } : undefined,
      organization: orgId ? [orgId] : [],
      agendaItem,
      invitation: einladung ? datei(einladung) : undefined,
      resultsProtocol: protokoll && protokoll !== einladung ? datei(protokoll) : undefined,
      auxiliaryFile: sitzungsDateien.filter((d) => d !== einladung && d !== protokoll).map(datei),
      quelle: 'regisafe',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, body, meeting, stats));
    stats.meetings++;
  }
  log(`    Sitzungen: ${stats.meetings} gelesen`);

  // 4. Vorlagen aus den Sitzungsvorlagen der TOPs, Beratungsfolge aus allen gespeicherten Tagesordnungen
  const auftritte = db.prepare(
    `SELECT a.id AS ai, a.meeting_id AS mid, m.start, mo.organization_id AS org
     FROM agenda_item a JOIN meeting m ON m.id = a.meeting_id
     LEFT JOIN meeting_organization mo ON mo.meeting_id = m.id
     WHERE a.consultation_id LIKE ? ORDER BY m.start`,
  );
  for (const [nr, v] of vorlagen) {
    const paperId = vorlageId(nr);
    const rows = auftritte.all(`${paperId}#%`) as Array<{ ai: string; mid: string; start: string; org: string | null }>;
    const weitere = [...new Map(v.weitere.map((d) => [d.id, d])).values()];
    const paper = {
      id: paperId,
      name: v.name,
      reference: nr,
      date: rows[0]?.start?.slice(0, 10),
      paperType: 'Sitzungsvorlage',
      mainFile: datei(v.haupt),
      auxiliaryFile: weitere.map(datei),
      consultation: rows.map((r) => ({
        id: `${paperId}#${new URL(r.mid).searchParams.get('sitzungId') ?? r.ai}`,
        agendaItem: r.ai,
        meeting: r.mid,
        organization: r.org ? [r.org] : [],
      })),
      quelle: 'regisafe',
    } as unknown as OParlPaper;
    tx(db, () => upsertPaper(db, v.body, paper, stats));
    stats.papers++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
