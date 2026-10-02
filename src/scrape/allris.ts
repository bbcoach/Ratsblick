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
 * Scraper für ALLRIS 4 (Apache-Wicket-Oberfläche), geprüft an gremieninfo.trier.de/public/ (01.10.2026).
 * - Kalender `si010?MM=…&YY=…`: die Tabelle kommt erst per Wicket-Ajax (`si010?0-1.0-&MM=…`) und braucht das
 *   Sitzungs-Cookie der Seite. Über den Weiterleiter läuft das Cookie in `x-ratsblick-set-cookie`/`x-ratsblick-cookie`.
 * - Sitzung `to010?SILFDNR=…` und Vorlage `vo020?VOLFDNR=…` sind ohne Sitzung abrufbar. Vorlagen enthalten
 *   Beschlussvorschlag und Begründung als HTML-Text.
 * - PDFs liegen unter `wicket/resource/org.apache.wicket.Application/docNNN.pdf` und sind direkt abrufbar.
 */

export interface AllrisKalenderEintrag {
  silfdnr: string;
  name: string;
  datum: string; // TT.MM.JJJJ
  zeit: string | null;
  raum: string | null;
}

export interface AllrisDokument {
  name: string;
  url: string; // relativ zur Basis, z. B. wicket/resource/…/doc1502509.pdf
}

export interface AllrisTop {
  tolfdnr: string;
  nr: string;
  oeffentlich: boolean;
  betreff: string;
  vorlage: { volfdnr: string; nr: string } | null;
}

export interface AllrisSitzung {
  gremium: string | null;
  grlfdnr: string | null;
  datum: string | null;
  zeit: string | null;
  ort: string | null;
  status: string | null;
  dokumente: AllrisDokument[];
  tops: AllrisTop[];
}

export interface AllrisVorlage {
  nr: string | null;
  betreff: string | null;
  art: string | null;
  federfuehrung: string | null;
  dokumente: AllrisDokument[];
  /** Beschlussvorschlag, Begründung u. Ä. als Text */
  text: string | null;
}

const feld = (html: string, id: string) => {
  const m = new RegExp(`<span[^>]*id="${id}"[^>]*>([\\s\\S]*?)</span>\\s*(?:</dd>|<span|<dt)`).exec(html);
  return m ? text(m[1]) || null : null;
};

/** Dokumente aus der Kopfleiste „Dokumente“ (nur direkte PDF-Links, keine Wicket-Aktionen). */
export function parseDokumente(html: string): AllrisDokument[] {
  const i = html.indexOf('id="dokumenteHeaderPanel"');
  if (i < 0) return [];
  const block = html.slice(i, html.indexOf('</aside>', i));
  const out: AllrisDokument[] = [];
  for (const m of block.matchAll(/<a href="\.\/(wicket\/resource\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
    out.push({ url: m[1]!, name: text(m[2]) || 'Dokument' });
  }
  return out;
}

/** Kalender aus der Ajax-Antwort; nur Sitzungen mit veröffentlichter Tagesordnung (verlinkt). */
export function parseKalender(xml: string): AllrisKalenderEintrag[] {
  const out: AllrisKalenderEintrag[] = [];
  for (const zeile of xml.split(/<tr\b/).slice(1)) {
    const a = /<a href="\.\/to010\?SILFDNR=(\d+)[^"]*"[^>]*data-simpletooltip-text="[^"]*?(\d{2}\.\d{2}\.\d{4})(?: um (\d{1,2}:\d{2}))?[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(zeile);
    if (!a) continue;
    const raum = /<td class="raum">([\s\S]*?)<\/td>/.exec(zeile);
    out.push({ silfdnr: a[1]!, datum: a[2]!, zeit: a[3] ?? null, name: text(a[4]), raum: raum ? text(raum[1]) || null : null });
  }
  return out;
}

/** Adresse der Ajax-Anfrage, die die Kalendertabelle lädt (Seitenversion steht in der Seite). */
export function kalenderAjaxPfad(html: string, monat: number, jahr: number): string {
  const m = /"u":"\.\/(si010\?\d+-\d+\.\d+-&[^"]*)"/.exec(html);
  return m ? m[1]!.replace(/&amp;/g, '&') : `si010?0-1.0-&MM=${monat}&YY=${jahr}`;
}

export function parseSitzung(html: string): AllrisSitzung {
  const gremium = /id="sigremium">\s*<a href="\.\/gr020\?GRLFDNR=(\d+)">([\s\S]*?)<\/a>/.exec(html);
  const datum = /id="sidatum">[\s\S]*?(\d{2}\.\d{2}\.\d{4})/.exec(html);
  const raum = feld(html, 'siraum');
  const ort = feld(html, 'siort');
  const status = feld(html, 'sistat');

  const tops: AllrisTop[] = [];
  const t = html.indexOf('id="toTreeTable"');
  if (t >= 0) {
    const tabelle = html.slice(html.indexOf('<tbody>', t), html.indexOf('</tbody>', t));
    for (const zeile of tabelle.split(/<tr\b/).slice(1)) {
      const nr = /<a href="#" id="link_(\d+)"[^>]*>\s*([ÖN])\s*([\d.]+[a-z]?)\s*<\/a>/.exec(zeile);
      if (!nr) continue; // Überschriften „Öffentlicher Teil“ u. Ä.
      const betreff = /<a href="\.\/to020\?TOLFDNR=\d+[^"]*" id="betreff_\d+">([\s\S]*?)<\/a>/.exec(zeile);
      const vo = /<a href="\.\/vo020\?VOLFDNR=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(zeile);
      tops.push({
        tolfdnr: nr[1]!,
        nr: nr[3]!,
        oeffentlich: nr[2] === 'Ö',
        betreff: text(betreff?.[1]?.replace(/<span class="zusatzinfo">[\s\S]*?<\/span>/, '')),
        vorlage: vo ? { volfdnr: vo[1]!, nr: text(vo[2]) } : null,
      });
    }
  }
  return {
    gremium: gremium ? text(gremium[2]) : null,
    grlfdnr: gremium?.[1] ?? null,
    datum: datum?.[1] ?? null,
    zeit: feld(html, 'sizeit'),
    ort: [raum, ort].filter(Boolean).join(', ') || null,
    status: status ? status.replace(/[()]/g, '').trim() : null,
    dokumente: parseDokumente(html),
    tops,
  };
}

export function parseVorlage(html: string): AllrisVorlage {
  const titel = /<h1 class="title">([\s\S]*?)<\/h1>/.exec(html);
  const nr = titel ? /-\s*([^-]+)$/.exec(text(titel[1]))?.[1]?.trim() ?? null : null;
  // Textabschnitte (Beschlussvorschlag, Begründung, Sachverhalt …), ohne Beratungsfolge und Anlagen
  const teile: string[] = [];
  const abschnitte = [...html.matchAll(/<h2 class="expandedTitle">([^<]*)<\/h2>/g)];
  abschnitte.forEach((m, i) => {
    const titel = m[1]!.trim();
    if (/beratungsfolge|anlagen/i.test(titel)) return;
    const ende = abschnitte[i + 1]?.index ?? html.indexOf('<footer', m.index);
    const inhalt = text(html.slice(m.index! + m[0].length, ende > 0 ? ende : undefined).replace(/<script[\s\S]*?<\/script>/g, ''));
    if (inhalt) teile.push(`${titel}: ${inhalt}`);
  });
  return {
    nr,
    betreff: feld(html, 'vobetreff'),
    art: feld(html, 'voart'),
    federfuehrung: feld(html, 'vofamt'),
    dokumente: parseDokumente(html),
    text: teile.join('\n\n') || null,
  };
}

// ---------- Körperschaften aus Gremiumsnamen ----------
/**
 * Orte der Räte („Gemeinderat der Ortsgemeinde Aull“, „Ortsgemeinderat Wiltingen“, „Stadtrat der Stadt Diez“, „Stadtrat Konz“).
 * Wert: true = Stadt.
 */
export function orteAusGremien(namen: Iterable<string>): Map<string, boolean> {
  const orte = new Map<string, boolean>();
  for (const n of namen) {
    const m =
      /^(?:Orts)?[Gg]emeinderat\s+(?:der\s+Ortsgemeinde\s+)?(.+)$/.exec(n.trim()) ?? /^(Stadtrat)\s+(?:der\s+Stadt\s+)?(.+)$/.exec(n.trim());
    if (!m) continue;
    const stadt = m[1] === 'Stadtrat';
    const ort = (stadt ? m[2] : m[1])!.trim();
    orte.set(ort, stadt || (orte.get(ort) ?? false));
  }
  return orte;
}

/**
 * Ort, zu dem ein Gremium gehört, oder null für die Verbandsgemeinde. Erkennt den Ort am Ende („Jugend- und Kulturausschuss
 * Wasserliesch“), nach „der Ortsgemeinde“/„der Stadt“, vor einem Bindestrich („Ortsbeirat Konz-Könen“) und abgekürzt
 * („Bauausschuss OG Berg“ → „Berg (Pfalz)“). Alles mit „Verbandsgemeinde“ oder „VG“ gehört zur VG.
 */
export function ortAusGremium(name: string, orte: Map<string, boolean>): string | null {
  const n = name.trim();
  if (/Verbandsgemeinde|\bVG\b/.test(n)) return null;
  const liste = [...orte.keys()].sort((a, b) => b.length - a.length);
  const esc = (o: string) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const treffer = liste.find((o) => new RegExp(`(?:^|\\s)${esc(o)}(?=$|[\\s,-])`).test(n));
  if (treffer) return treffer;
  const og = /\bOG\s+(\S+)/.exec(n)?.[1];
  if (og) {
    const passend = liste.filter((o) => o.split(/\s/)[0] === og);
    if (passend.length === 1) return passend[0]!;
  }
  return null;
}

// ---------- Abgleich ----------
export interface AllrisOptionen {
  monateZurueck?: number;
  monateVoraus?: number;
  festNachTagen?: number;
  alles?: boolean;
  log?: (msg: string) => void;
  now?: Date;
}

function datei(base: string, d: AllrisDokument, text?: string | null): OParlFile {
  const url = new URL(d.url, base).href;
  return { id: url, name: d.name, accessUrl: url, downloadUrl: url, mimeType: 'application/pdf', ...(text ? { text } : {}) } as OParlFile;
}

/** Cookie aus der Antwort: über den Weiterleiter in eigener Kopfzeile, direkt als Set-Cookie. */
function cookieAus(h: Headers): string | null {
  const relay = h.get('x-ratsblick-set-cookie');
  if (relay) return relay;
  const direkt = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [h.get('set-cookie')].filter((c): c is string => !!c);
  return direkt.length ? direkt.map((c) => c.split(';')[0]).join('; ') : null;
}

export async function syncAllris(
  db: DatabaseSync,
  client: OParlClient,
  source: SourceRecord,
  opts: AllrisOptionen = {},
): Promise<SyncStats> {
  const log = opts.log ?? (() => {});
  const u = new URL(source.url);
  const base = `${u.origin}${u.pathname.replace(/oparl\/.*$/, '').replace(/\/?$/, '/')}`;
  const jetzt = opts.now ?? new Date();
  const stats: SyncStats = { bodies: 0, organizations: 0, meetings: 0, agendaItems: 0, papers: 0, consultations: 0, files: 0 };

  upsertSource(db, source);
  db.prepare('UPDATE source SET vendor = ?, oparl_version = NULL WHERE id = ?').run('ALLRIS 4 (Scraper)', source.id);
  const bodyId = `${base}#koerperschaft`;
  tx(db, () => upsertBody(db, source.id, { id: bodyId, name: source.name.replace(/^VG /, 'Verbandsgemeinde '), shortName: source.id } as never));
  stats.bodies = 1;

  // 1. Kalender je Monat: Seite (setzt Sitzungs-Cookie), dann Ajax-Abruf der Tabelle
  let cookie: string | null = null;
  const merke = (h: Headers) => {
    cookie = cookieAus(h) ?? cookie;
  };
  // Cookie für direkte Abrufe und für den Weiterleiter (der nur x-ratsblick-cookie weitergibt)
  const mitCookie = (): Record<string, string> => (cookie ? { Cookie: cookie, 'x-ratsblick-cookie': cookie } : {});
  const eintraege = new Map<string, AllrisKalenderEintrag>();
  const von = opts.monateZurueck ?? 2;
  const bis = opts.monateVoraus ?? 3;
  for (let i = -von; i <= bis; i++) {
    const d = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() + i, 1));
    const monat = d.getUTCMonth() + 1;
    const jahr = d.getUTCFullYear();
    const seite = `si010?MM=${monat}&YY=${jahr}`;
    try {
      const html = await client.getText(`${base}${seite}`, { headers: mitCookie(), kopf: merke });
      const xml = await client.getText(`${base}${kalenderAjaxPfad(html, monat, jahr)}`, {
        headers: {
          ...mitCookie(),
          'Wicket-Ajax': 'true',
          'Wicket-Ajax-BaseURL': seite,
          'X-Requested-With': 'XMLHttpRequest',
        },
        kopf: merke,
      });
      for (const e of parseKalender(xml)) eintraege.set(e.silfdnr, e);
    } catch (err) {
      log(`    Kalender ${monat}/${jahr}: ${(err as Error).message}`);
    }
  }
  log(`  Kalender: ${eintraege.size} Sitzungen in ${von + bis + 1} Monaten`);

  // 2. Sitzungen laden
  const festVor = new Date(jetzt.getTime() - (opts.festNachTagen ?? 14) * 86_400_000).toISOString();
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?');
  const geladen: Array<{ e: AllrisKalenderEintrag; s: AllrisSitzung; meetingId: string; start: string }> = [];
  for (const e of eintraege.values()) {
    const meetingId = `${base}to010?SILFDNR=${e.silfdnr}`;
    const start = berlinIso(e.datum, e.zeit ?? '00:00');
    if (!opts.alles && start < festVor && (vorhanden.get(meetingId) as { n: number }).n > 0) continue;
    try {
      geladen.push({ e, s: parseSitzung(await client.getText(`${meetingId}&refresh=false`)), meetingId, start });
    } catch (err) {
      log(`    Sitzung ${e.silfdnr}: ${(err as Error).message}`);
    }
  }

  // 3. Körperschaften: mit `mandanten: true` je Ortsgemeinde/Stadt eine eigene, erkannt an den Gremiumsnamen
  // (auch denen früherer Läufe), sonst alles bei der Quelle
  const bekannteGremien = (db.prepare('SELECT o.name FROM organization o JOIN body b ON b.id = o.body_id WHERE b.source_id = ?').all(source.id) as Array<{
    name: string | null;
  }>).map((r) => r.name ?? '');
  const orte = source.mandanten ? orteAusGremien([...bekannteGremien, ...geladen.map((g) => g.s.gremium ?? '')]) : new Map<string, boolean>();
  const angelegt = new Set<string>([bodyId]);
  const koerperschaftZu = (gremium: string | null): string => {
    const ort = gremium && orte.size ? ortAusGremium(gremium, orte) : null;
    if (!ort) return bodyId;
    const id = `${base}#koerperschaft-${encodeURIComponent(ort)}`;
    if (!angelegt.has(id)) {
      angelegt.add(id);
      tx(db, () => upsertBody(db, source.id, { id, name: `${orte.get(ort) ? 'Stadt' : 'Ortsgemeinde'} ${ort}`, shortName: ort } as never));
      stats.bodies++;
    }
    return id;
  };

  // 4. Sitzungen speichern
  const gremien = new Set<string>();
  const vorlagen = new Map<string, string>(); // VOLFDNR → Körperschaft der ersten Sitzung
  for (const { e, s, meetingId, start } of geladen) {
    const body = koerperschaftZu(s.gremium);
    const orgId = s.grlfdnr ? `${base}gr020?GRLFDNR=${s.grlfdnr}` : null;
    if (orgId && s.gremium && !gremien.has(orgId)) {
      gremien.add(orgId);
      tx(db, () => upsertOrganization(db, body, { id: orgId, name: s.gremium, organizationType: 'Gremium' } as never));
      stats.organizations++;
    }
    const agendaItem = s.tops.map((t, i) => {
      const paperId = t.vorlage ? `${base}vo020?VOLFDNR=${t.vorlage.volfdnr}` : null;
      if (t.vorlage && !vorlagen.has(t.vorlage.volfdnr)) vorlagen.set(t.vorlage.volfdnr, body);
      return {
        id: `${base}to020?TOLFDNR=${t.tolfdnr}`,
        number: t.nr,
        order: i + 1,
        name: t.betreff,
        public: t.oeffentlich,
        consultation: paperId ? `${paperId}#${e.silfdnr}` : undefined,
        vorlage: paperId,
      };
    });
    const einladung = s.dokumente.find((d) => /einladung|bekanntmachung/i.test(d.name));
    const protokoll = s.dokumente.find((d) => /niederschrift|protokoll/i.test(d.name));
    const meeting = {
      id: meetingId,
      name: s.gremium ?? e.name,
      meetingState: start < jetzt.toISOString() ? 'durchgeführt' : (s.status ?? 'eingeladen'),
      start,
      location: s.ort ?? e.raum ? { description: s.ort ?? e.raum ?? undefined } : undefined,
      organization: orgId ? [orgId] : [],
      agendaItem,
      invitation: einladung ? datei(base, einladung) : undefined,
      resultsProtocol: protokoll ? datei(base, protokoll) : undefined,
      auxiliaryFile: s.dokumente.filter((d) => d !== einladung && d !== protokoll).map((d) => datei(base, d)),
      quelle: 'allris',
    } as unknown as OParlMeeting;
    tx(db, () => upsertMeeting(db, body, meeting, stats));
    stats.meetings++;
  }
  log(`    Sitzungen: ${stats.meetings} gelesen`);

  // 5. Vorlagen (bereits gespeicherte mit Text nicht erneut laden)
  const bekannt = db.prepare('SELECT raw FROM paper WHERE id = ?');
  const auftritte = db.prepare(
    `SELECT a.id AS ai, a.meeting_id AS mid, m.start, mo.organization_id AS org
     FROM agenda_item a JOIN meeting m ON m.id = a.meeting_id
     LEFT JOIN meeting_organization mo ON mo.meeting_id = m.id
     WHERE a.consultation_id LIKE ? ORDER BY m.start`,
  );
  for (const [volfdnr, vorlageBody] of vorlagen) {
    const paperId = `${base}vo020?VOLFDNR=${volfdnr}`;
    const alt = bekannt.get(paperId) as { raw: string } | undefined;
    const gespeichert = alt ? (JSON.parse(alt.raw).vorlage as AllrisVorlage | undefined) : undefined;
    let v: AllrisVorlage;
    if (gespeichert?.text && !opts.alles) {
      v = gespeichert;
    } else {
      try {
        v = parseVorlage(await client.getText(`${paperId}&refresh=false`));
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
      // Der Text der Vorlage steht als HTML in der Seite; er wird wie bei OParl am Hauptdokument geführt
      mainFile: haupt ? datei(base, haupt, v.text) : v.text ? ({ id: `${paperId}#text`, name: 'Vorlage', text: v.text } as OParlFile) : undefined,
      auxiliaryFile: v.dokumente.filter((d) => d !== haupt).map((d) => datei(base, d)),
      consultation: rows.map((r) => ({
        id: `${paperId}#${new URL(r.mid).searchParams.get('SILFDNR') ?? r.ai}`,
        agendaItem: r.ai,
        meeting: r.mid,
        organization: r.org ? [r.org] : [],
      })),
      vorlage: v,
      quelle: 'allris',
    } as unknown as OParlPaper;
    tx(db, () => upsertPaper(db, vorlageBody, paper, stats));
    stats.papers++;
  }
  db.prepare('UPDATE source SET last_sync_at = ? WHERE id = ?').run(new Date().toISOString(), source.id);
  return stats;
}
