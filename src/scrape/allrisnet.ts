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
 * Scraper für das ältere ALLRIS.net (CC e-gov, `/bi/*.asp`), geprüft an www.vg-winnweiler.sitzung-online.de (02.10.2026).
 * - Kalender `si010_j.asp?MM=…&YY=…` (Monatsansicht; `si010_e.asp` ist dort gesperrt)
 * - Gremienliste im Auswahlfeld `GRA` des Kalenders: oberste Ebene = Rat einer Körperschaft, eingerückt = Ausschüsse
 * - Sitzung `to010.asp?SILFDNR=…` (Kopf, Tagesordnung, Ergebnis im Titel des NA-Knopfs, Vorlagennummer am TOP)
 * - Vorlage `vo020.asp?VOLFDNR=…` mit Beschlussvorschlag/Sachverhalt als HTML
 * - Dokumente `do027.asp?DOLFDNR=…&options=64` (leitet auf eine kurzlebige PDF-Adresse weiter)
 * - Ist die Monatsansicht gesperrt („Zugriff verweigert“), die anderen Kalender `si010_e.asp` (Mainz-Bingen) bzw. `si010.asp`
 *   (Eifelkreis Bitburg-Prüm); sind alle gesperrt (Kirchen, Betzdorf-Gebhardshain), gibt es den Kalender nur je Rat: Räteliste `pa000.asp`, Kalender `si010_a.asp?MM=…&YY=…&PALFDNR=…` (Ausschüsse erscheinen beim Rat)
 * Seiten sind ISO-8859-1 ohne Angabe im Content-Type (getText liest den Zeichensatz aus der Seite).
 */

export interface AllrisNetGremium {
  id: string;
  name: string;
  /** Rat der Körperschaft, zu der das Gremium gehört (bei Räten das Gremium selbst) */
  rat: string;
}

export interface AllrisNetTermin {
  silfdnr: string;
  datum: string; // TT.MM.JJJJ
  zeit: string | null;
  name: string;
  raum: string | null;
  /** Rat, über dessen Kalender die Sitzung gefunden wurde (nur bei Kalendern je Rat) */
  rat?: string;
}

export interface AllrisNetDokument {
  id: string;
  name: string;
}

export interface AllrisNetTop {
  tolfdnr: string;
  nr: string;
  oeffentlich: boolean;
  betreff: string;
  ergebnis: string | null;
  vorlage: { volfdnr: string; nr: string } | null;
}

export interface AllrisNetSitzung {
  bezeichnung: string | null;
  gremiumId: string | null;
  gremium: string | null;
  ort: string | null;
  dokumente: AllrisNetDokument[];
  tops: AllrisNetTop[];
}

export interface AllrisNetVorlage {
  nr: string | null;
  betreff: string | null;
  art: string | null;
  dokumente: AllrisNetDokument[];
  text: string | null;
}

const zelle = (html: string, label: string) => {
  const m = new RegExp(`<td class="kb1"[^>]*>${label}:</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`).exec(html);
  return m ? text(m[1]) || null : null;
};

/** Gremien aus dem Auswahlfeld GRA; eingerückte Einträge gehören zum vorangehenden Rat. */
export function parseGremien(html: string): AllrisNetGremium[] {
  const i = html.indexOf('<select name="GRA"');
  if (i < 0) return [];
  const auswahl = html.slice(i, html.indexOf('</select>', i));
  const out: AllrisNetGremium[] = [];
  let rat: string | null = null;
  for (const m of auswahl.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)/g)) {
    if (m[1] === '99999999') continue;
    const eingerueckt = /^(?:&nbsp;|\s)+/.test(m[2]!);
    const name = text(m[2]);
    if (!eingerueckt) rat = m[1]!;
    out.push({ id: m[1]!, name, rat: rat ?? m[1]! });
  }
  return out;
}

/** Räte aus der Auswahlseite pa000.asp (Links auf den Kalender je Rat). */
export function parseRaete(html: string): AllrisNetGremium[] {
  const out: AllrisNetGremium[] = [];
  // Namen stehen fett hinter dem Link (je nach Aufruf auf si010_a.asp oder nur „?PALFDNR=…“)
  for (const m of html.matchAll(/PALFDNR=(\d+)"[^>]*><b>([^<]+)/g)) {
    if (!out.some((g) => g.id === m[1])) out.push({ id: m[1]!, name: text(m[2]), rat: m[1]! });
  }
  return out;
}

/** Name der Körperschaft zu einem Rat („Ortsgemeinderat Börrstadt“ → „Ortsgemeinde Börrstadt“). */
export function koerperschaftsName(rat: string): string {
  // „Ortsgemeinderat der Ortsgemeinde Brachbach“ → „Ortsgemeinde Brachbach“
  const der = /^\S*(?:rat|tag)\s+der\s+((?:Orts|Verbands)?[Gg]emeinde\s.+|Stadt\s.+|Landkreis\s.+)$/.exec(rat.trim());
  if (der) return der[1]!;
  return rat
    .replace(/^Ortsgemeinderat\s+/, 'Ortsgemeinde ')
    .replace(/^Verbandsgemeinderat\s+/, 'Verbandsgemeinde ')
    .replace(/^Stadtrat\s+/, 'Stadt ')
    .replace(/^Gemeinderat\s+/, 'Gemeinde ')
    .replace(/^Kreistag\s+/, 'Landkreis ');
}

export function parseKalender(html: string, monat: number, jahr: number): AllrisNetTermin[] {
  const out: AllrisNetTermin[] = [];
  let tag: string | null = null;
  for (const zeile of html.split(/<tr\b/).slice(1)) {
    const t = /<td class="text2" width="20">(?:<span[^>]*>)?(?:&nbsp;)*(\d{1,2})/.exec(zeile);
    if (t) tag = t[1]!;
    const a = /<a href="to010\.asp\?SILFDNR=(\d+)">([\s\S]*?)<\/a>/.exec(zeile);
    if (!a || !tag) continue;
    const zeit = /<td class="text2">(\d{1,2}:\d{2})/.exec(zeile);
    const raum = /<td class="text4">([\s\S]*?)<\/td>/.exec(zeile);
    out.push({
      silfdnr: a[1]!,
      datum: `${tag.padStart(2, '0')}.${String(monat).padStart(2, '0')}.${jahr}`,
      zeit: zeit?.[1] ?? null,
      name: text(a[2]),
      raum: raum ? text(raum[1]) || null : null,
    });
  }
  return out;
}

/** Dokumente als Formulare zu do027.asp (Knopfbeschriftung = Name). */
function dokumente(html: string): AllrisNetDokument[] {
  const out: AllrisNetDokument[] = [];
  for (const m of html.matchAll(/<form action="do027\.asp"[\s\S]*?name="DOLFDNR" value="(\d+)"[\s\S]*?class="il2_p" value="([^"]*)"/g)) {
    if (!out.some((d) => d.id === m[1])) out.push({ id: m[1]!, name: text(m[2]) || 'Dokument' });
  }
  return out;
}

export function parseSitzung(html: string): AllrisNetSitzung {
  // Bei vergangenen Sitzungen trägt der Link weitere Parameter und eine Nummer aus der damaligen Wahlperiode
  // Räte verlinken auf pa020 (PALFDNR), Ausschüsse/Ortsbeiräte teils auf au020 (AULFDNR, andere Nummern)
  const gremium = /<td class="kb1">Gremium:<\/td>\s*<td[^>]*><a href="(?:pa|au)020\.asp\?[^"]*?(?:PA|AU)LFDNR=(\d+)[^"]*">([\s\S]*?)<\/a>/.exec(html);
  const ort = [zelle(html, 'Raum'), zelle(html, 'Ort')].filter(Boolean).join(', ') || null;
  const tops: AllrisNetTop[] = [];
  for (const zeile of html.split(/<tr class="zl1[12]"/).slice(1)) {
    const nr = /<a href="to010\.asp\?SILFDNR=\d+&TOLFDNR=(\d+)#beschluss"[^>]*>(?:<span[^>]*>)?([ÖN])&nbsp;([\d.]+[a-z]?)/.exec(zeile);
    if (!nr) continue;
    // Betreff: Link auf to020 oder letzte Textzelle vor der Vorlage
    const zellen = [...zeile.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!);
    const betreff = /<a href="to020\.asp\?TOLFDNR=\d+">([\s\S]*?)<\/a>/.exec(zeile)?.[1] ?? zellen[3];
    const ergebnis = /class="il1_naz" value="NA" title="([^"]*)"/.exec(zeile)?.[1] ?? null;
    const vo = /<a href="vo020\.asp\?VOLFDNR=(\d+)">([\s\S]*?)<\/a>/.exec(zeile);
    tops.push({
      tolfdnr: nr[1]!,
      nr: nr[3]!,
      oeffentlich: nr[2] === 'Ö',
      betreff: text(betreff),
      ergebnis: ergebnis ? text(ergebnis) : null,
      vorlage: vo ? { volfdnr: vo[1]!, nr: text(vo[2]) } : null,
    });
  }
  const kopfEnde = html.indexOf('<table class="tl1"');
  return {
    bezeichnung: zelle(html, 'Bezeichnung'),
    gremiumId: gremium?.[1] ?? null,
    gremium: gremium ? text(gremium[2]) : null,
    ort,
    dokumente: dokumente(kopfEnde > 0 ? html.slice(0, kopfEnde) : html),
    tops,
  };
}

export function parseVorlage(html: string): AllrisNetVorlage {
  const nr = /<h1>Vorlage - ([^<&]+)/.exec(html)?.[1]?.trim() ?? null;
  const betreff = /<td class="kb1">Betreff:<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(html);
  // Textteile ab der ersten Sprungmarke (Beschlussvorschlag, Sachverhalt, Finanzielle Auswirkungen), ohne Anlagenliste
  const ab = html.indexOf('<a name="allris');
  let teile = ab > 0 ? html.slice(ab) : '';
  const anlagen = teile.indexOf('<a name="allrisAN"');
  if (anlagen > 0) teile = teile.slice(0, anlagen);
  const fuss = teile.indexOf('<div id="risfoot"');
  if (fuss > 0) teile = teile.slice(0, fuss);
  const inhalt = text(teile.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<\?xml[^>]*>/g, ''));
  return {
    nr,
    betreff: betreff ? text(betreff[1]!.replace(/<br\s*\/?>/g, ' ')) : null,
    art: /<td class="kb1">Vorlage-Art:<\/td><td[^>]*>([\s\S]*?)<\/td>/.exec(html)?.[1]?.trim() ?? null,
    dokumente: dokumente(ab > 0 ? html.slice(0, ab) : html),
    text: inhalt || null,
  };
}

// ---------- Abgleich ----------
export interface AllrisNetOptionen {
  monateZurueck?: number;
  monateVoraus?: number;
  festNachTagen?: number;
  alles?: boolean;
  log?: (msg: string) => void;
  now?: Date;
}

/** Kalenderansichten in der Reihenfolge, in der sie versucht werden; je nach Einrichtung ist nur eine freigegeben. */
const KALENDER = ['si010_j.asp', 'si010_e.asp', 'si010.asp'];

export async function syncAllrisNet(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: AllrisNetOptionen = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const base = source.url.replace(/[^/]*$/, ''); // …/bi/
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };
  const datei = (d: AllrisNetDokument, inhalt?: string | null): OParlFile => {
    const url = `${base}do027.asp?DOLFDNR=${d.id}&options=64`;
    return { id: url, name: d.name, accessUrl: url, downloadUrl: url, mimeType: 'application/pdf', ...(inhalt ? { text: inhalt } : {}) } as OParlFile;
  };

  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('ALLRIS.net (Scraper)', source.id);

  // 1. Kalender je Monat; die erste Seite liefert auch die Gremienliste
  const termine = new Map<string, AllrisNetTermin>();
  let gremien: AllrisNetGremium[] = [];
  let jeRat = false;
  let kalender = KALENDER[0]!;
  const von = opts.monateZurueck ?? 2;
  const bis = opts.monateVoraus ?? 3;
  for (let i = -von; i <= bis; i++) {
    const d = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() + i, 1));
    const monat = d.getUTCMonth() + 1;
    const jahr = d.getUTCFullYear();
    try {
      if (jeRat) {
        for (const r of gremien) {
          const html = await client.getText(`${base}si010_a.asp?MM=${monat}&YY=${jahr}&PALFDNR=${r.id}`);
          for (const t of parseKalender(html, monat, jahr)) if (!termine.has(t.silfdnr)) termine.set(t.silfdnr, { ...t, rat: r.id });
        }
        continue;
      }
      const html = await client.getText(`${base}${kalender}?MM=${monat}&YY=${jahr}`);
      const naechster = KALENDER[KALENDER.indexOf(kalender) + 1];
      if (i === -von && /Zugriff verweigert/i.test(html) && naechster) {
        // Kalenderansicht gesperrt: die nächste versuchen (Mainz-Bingen: si010_e, Bitburg-Prüm: si010)
        log(`  ${kalender} gesperrt – versuche ${naechster}`);
        kalender = naechster;
        i--;
        continue;
      }
      if (i === -von && /Zugriff verweigert/i.test(html)) {
        // Auch der gesperrt: Kalender je Rat
        jeRat = true;
        gremien = parseRaete(await client.getText(`${base}pa000.asp`));
        log(`  Monatsansicht gesperrt – Kalender je Rat (${gremien.length} Räte)`);
        i--;
        continue;
      }
      if (!gremien.length) gremien = parseGremien(html);
      for (const t of parseKalender(html, monat, jahr)) termine.set(t.silfdnr, t);
    } catch (err) {
      log(`    Kalender ${monat}/${jahr}: ${(err as Error).message}`);
    }
  }
  log(`  Gremien: ${gremien.length}, Kalender: ${termine.size} Sitzungen in ${von + bis + 1} Monaten`);

  // 2. Körperschaften aus den Räten (oberste Ebene der Gremienliste)
  const gremiumNachId = new Map(gremien.map((g) => [g.id, g]));
  const koerperschaften = new Map<string, string>(); // Rat-ID → Körperschafts-ID
  const koerperschaft = (ratId: string) => {
    let id = koerperschaften.get(ratId);
    if (!id) {
      const rat = gremiumNachId.get(ratId);
      id = `${base}pa020.asp?PALFDNR=${ratId}#koerperschaft`;
      const name = rat ? koerperschaftsName(rat.name) : source.name.replace(/^VG /, 'Verbandsgemeinde ');
      const bodyId = id;
      tx(db, () => upsertBody(db, source.id, { id: bodyId, name, shortName: ratId } as never));
      stats.bodies++;
      koerperschaften.set(ratId, id);
    }
    return id;
  };
  /**
   * Gremium und Rat einer Sitzung: nach Namen, wenn eindeutig; sonst über die Ortsgemeinde im Titel
   * („… der Ortsgemeinde Münchweiler“); zuletzt über die Nummer (die bei vergangenen Wahlperioden abweicht).
   */
  const gremiumZu = (s: AllrisNetSitzung, titel: string): { g?: AllrisNetGremium; rat?: string } => {
    const gleich = gremien.filter((g) => g.name === s.gremium);
    if (gleich.length === 1) return { g: gleich[0], rat: gleich[0]!.rat };
    const ort = /Ortsgemeinde\s+([^\s,()]+)/.exec(`${s.bezeichnung ?? ''} ${titel}`)?.[1];
    const ortsRat = ort ? gremien.find((g) => g.id === g.rat && g.name === `Ortsgemeinderat ${ort}`)?.id : undefined;
    if (ortsRat) return { g: gleich.find((g) => g.rat === ortsRat), rat: ortsRat };
    const g = gleich.find((x) => x.id === s.gremiumId) ?? (gleich.length ? undefined : gremiumNachId.get(s.gremiumId ?? ''));
    return { g, rat: g?.rat };
  };
  // Standard: Verbandsgemeinderat (Sitzungen ohne bekanntes Gremium)
  const vgRat = gremien.find((g) => g.id === g.rat && /^Verbandsgemeinderat/.test(g.name))?.id ?? gremien[0]?.id ?? '0';

  // 3. Sitzungen
  const festVor = new Date(jetzt.getTime() - (opts.festNachTagen ?? 14) * 86_400_000).toISOString();
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?');
  const orgs = new Set<string>();
  const vorlagen = new Map<string, string>(); // VOLFDNR → Körperschaft
  for (const t of termine.values()) {
    const meetingId = `${base}to010.asp?SILFDNR=${t.silfdnr}`;
    const start = berlinIso(t.datum, t.zeit ?? '00:00');
    if (!opts.alles && start < festVor && (vorhanden.get(meetingId) as { n: number }).n > 0) continue;
    let s: AllrisNetSitzung;
    try {
      s = parseSitzung(await client.getText(meetingId));
    } catch (err) {
      log(`    Sitzung ${t.silfdnr}: ${(err as Error).message}`);
      continue;
    }
    const { g, rat } = t.rat ? { g: gremiumNachId.get(s.gremiumId ?? ''), rat: t.rat } : gremiumZu(s, t.name);
    const body = koerperschaft(rat ?? vgRat);
    // Kalender je Rat bzw. ohne Gremienliste (si010.asp): Gremium über die Nummer aus der Sitzung
    const gremiumNr = g?.id ?? (t.rat || !gremien.length ? s.gremiumId : null);
    const orgId = gremiumNr ? `${base}pa020.asp?PALFDNR=${gremiumNr}` : null;
    if (orgId && !orgs.has(orgId)) {
      orgs.add(orgId);
      tx(db, () => upsertOrganization(db, body, { id: orgId, name: s.gremium ?? g?.name, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }
    const agendaItem = s.tops.map((top, i) => {
      const paperId = top.vorlage ? `${base}vo020.asp?VOLFDNR=${top.vorlage.volfdnr}` : null;
      if (top.vorlage && !vorlagen.has(top.vorlage.volfdnr)) vorlagen.set(top.vorlage.volfdnr, body);
      return {
        id: `${meetingId}#top-${top.tolfdnr}`,
        number: top.nr,
        order: i + 1,
        name: top.betreff,
        public: top.oeffentlich,
        result: top.ergebnis ?? undefined,
        consultation: paperId ? `${paperId}#${t.silfdnr}` : undefined,
        vorlage: paperId,
      };
    });
    const einladung = s.dokumente.find((d) => /bekanntmachung|einladung/i.test(d.name));
    const protokoll = s.dokumente.find((d) => /niederschrift|protokoll/i.test(d.name));
    const meeting = {
      id: meetingId,
      name: s.gremium ?? t.name,
      meetingState: start < jetzt.toISOString() ? 'durchgeführt' : 'eingeladen',
      start,
      location: s.ort ?? t.raum ? { description: s.ort ?? t.raum ?? undefined } : undefined,
      organization: orgId ? [orgId] : [],
      agendaItem,
      invitation: einladung ? datei(einladung) : undefined,
      resultsProtocol: protokoll && protokoll !== einladung ? datei(protokoll) : undefined,
      auxiliaryFile: s.dokumente.filter((d) => d !== einladung && d !== protokoll).map((d) => datei(d)),
      quelle: 'allris-net',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, body, meeting, stats));
    stats.meetings++;
  }
  log(`    Sitzungen: ${stats.meetings} gelesen`);

  // 4. Vorlagen (bereits gespeicherte mit Text nicht erneut laden)
  const bekannt = db.prepare('SELECT raw FROM paper WHERE id = ?');
  const auftritte = db.prepare(
    `SELECT a.id AS ai, a.meeting_id AS mid, m.start, mo.organization_id AS org
     FROM agenda_item a JOIN meeting m ON m.id = a.meeting_id
     LEFT JOIN meeting_organization mo ON mo.meeting_id = m.id
     WHERE a.consultation_id LIKE ? ORDER BY m.start`,
  );
  for (const [volfdnr, body] of vorlagen) {
    const paperId = `${base}vo020.asp?VOLFDNR=${volfdnr}`;
    const alt = bekannt.get(paperId) as { raw: string } | undefined;
    const gespeichert = alt ? (JSON.parse(alt.raw).vorlage as AllrisNetVorlage | undefined) : undefined;
    let v: AllrisNetVorlage;
    if (gespeichert?.text && !opts.alles) {
      v = gespeichert;
    } else {
      try {
        v = parseVorlage(await client.getText(paperId));
      } catch (err) {
        log(`    Vorlage ${volfdnr}: ${(err as Error).message}`);
        continue;
      }
    }
    const rows = auftritte.all(`${paperId}#%`) as Array<{ ai: string; mid: string; start: string; org: string | null }>;
    const haupt = v.dokumente.find((d) => /^vorlage$/i.test(d.name)) ?? v.dokumente[0];
    const paper = {
      id: paperId,
      name: v.betreff ?? undefined,
      reference: v.nr ?? undefined,
      date: rows[0]?.start?.slice(0, 10),
      paperType: v.art ?? undefined,
      mainFile: haupt ? datei(haupt, v.text) : v.text ? ({ id: `${paperId}#text`, name: 'Vorlage', text: v.text } as OParlFile) : undefined,
      auxiliaryFile: v.dokumente.filter((d) => d !== haupt).map((d) => datei(d)),
      consultation: rows.map((r) => ({
        id: `${paperId}#${new URL(r.mid).searchParams.get('SILFDNR') ?? r.ai}`,
        agendaItem: r.ai,
        meeting: r.mid,
        organization: r.org ? [r.org] : [],
      })),
      vorlage: v,
      quelle: 'allris-net',
    } as unknown as OParlPaper;
    tx(db, () => upsertPaper(db, body, paper, stats));
    stats.papers++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
