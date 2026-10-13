/**
 * Suchmaschinen: statische Seiten je Kommune (/ort/<name>/), Übersicht /orte/, sitemap.xml und robots.txt.
 *
 * Die App selbst lebt hinter „#/…“-Adressen und lädt alles per JavaScript – das findet Google kaum. Deshalb erzeugt der Export
 * zusätzlich für jede Gemeinde, Verbandsgemeinde, jeden Kreis und jede kreisfreie Stadt eine kleine, fertige HTML-Seite mit den
 * nächsten Sitzungen, den zuletzt besprochenen Themen und Links in die App. Kein JavaScript nötig, kein Abruf fremder Server.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gebiete } from '../sync/discover.js';

export const SITE = 'https://wahlheimat-rlp.de';

export interface SeoSitzung {
  id: string;
  start: string | null;
  gremium: string;
  ort: string | null;
  abgesagt: boolean;
  themen: string[];
}
export interface SeoVorlage { id: string; name: string; datum: string | null; art: string | null }
/** Zusammenfassung einer Körperschaft für ihre Seite */
export interface SeoKoerperschaft {
  name: string;
  kommend: SeoSitzung[];
  vergangen: SeoSitzung[];
  vorlagen: SeoVorlage[];
  ris: string | null;
  ohneRis: boolean;
}

/** Name → Adressteil: Kleinbuchstaben, Umlaute ausgeschrieben, sonst nur a–z, 0–9 und Bindestrich */
export function slug(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TZ = 'Europe/Berlin';
const datumLang = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const datumKurz = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const uhr = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

type Typ = 'gemeinde' | 'vg' | 'kreis';
interface Seite { id: string; typ: Typ; name: string; titelName: string; rat: string; pfad: string; kreis: string | null; vg: string | null; art: string }

/** Alle Seiten mit eindeutigen Adressen */
export function seitenListe(g: Gebiete): Seite[] {
  const kreisName = new Map(g.kreise.map((k) => [k.id, k.name]));
  const vgName = new Map(g.verbandsgemeinden.map((v) => [v.id, v.name]));
  const out: Seite[] = [];
  for (const k of g.kreise) {
    if (k.art === 'Kreisfreie Stadt') continue; // steht als Gemeinde (Schlüssel …000)
    out.push({ id: k.id, typ: 'kreis', name: k.name, titelName: k.name, rat: 'Kreistag', pfad: slug(k.name), kreis: null, vg: null, art: k.art });
  }
  for (const v of g.verbandsgemeinden) {
    out.push({ id: v.id, typ: 'vg', name: v.name, titelName: v.name, rat: 'Verbandsgemeinderat', pfad: slug(v.name.replace(/^Verbandsgemeinde /, 'VG ')), kreis: v.kreis, vg: null, art: 'Verbandsgemeinde' });
  }
  const zahl = new Map<string, number>();
  for (const x of g.gemeinden) zahl.set(slug(x.name), (zahl.get(slug(x.name)) ?? 0) + 1);
  const belegt = new Set(out.map((s) => s.pfad));
  for (const x of g.gemeinden) {
    let pfad = slug(x.name);
    if ((zahl.get(pfad) ?? 0) > 1 || belegt.has(pfad)) {
      const zusatz = x.vg ? vgName.get(x.vg)?.replace(/^Verbandsgemeinde /, '') : x.kreis ? kreisName.get(x.kreis) : '';
      pfad = `${pfad}-${slug(zusatz ?? '')}`;
      if (belegt.has(pfad)) pfad = `${pfad}-${x.id}`;
    }
    belegt.add(pfad);
    const stadt = x.art === 'Stadt' || x.art === 'Kreisfreie Stadt' || x.art === 'Große kreisangehörige Stadt';
    const titelName = x.art === 'Ortsgemeinde' || x.art === 'Gemeinde' ? `${x.art} ${x.name}` : stadt ? `Stadt ${x.name}` : x.name;
    out.push({
      id: x.id, typ: 'gemeinde', name: x.name, titelName, rat: stadt ? 'Stadtrat' : x.art === 'Ortsgemeinde' ? 'Ortsgemeinderat' : 'Gemeinderat',
      pfad, kreis: x.kreis, vg: x.vg, art: x.art,
    });
  }
  return out;
}

const CSS = `@font-face{font-family:"Public Sans";src:url(/fonts/public-sans-latin.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--bg:#f6f4f4;--surface:#fff;--fg:#1f1a1c;--muted:#655a5e;--line:#e4dcdf;--accent:#7b2736}
@media (prefers-color-scheme:dark){:root{--bg:#141112;--surface:#1f1a1c;--fg:#f1eced;--muted:#b3a7ab;--line:#3a3135;--accent:#e7a1ae}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 "Public Sans",system-ui,sans-serif}
@font-face{font-family:"Nunito";src:url(/fonts/nunito-latin.woff2) format("woff2");font-weight:200 900;font-display:swap}
header{position:sticky;top:0;z-index:5;background:#7b2736;color:#fff;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;min-height:54px;display:flex;align-items:center}
.logo{display:flex;align-items:center;gap:9px;color:#fff;text-decoration:none;max-width:760px;width:100%;margin:0 auto}
.logo img{width:32px;height:32px;flex:none;border-radius:8px;box-shadow:0 0 0 1.5px rgba(255,255,255,.3)}
.logo .wm{display:flex;flex-direction:column;font-family:"Nunito",sans-serif;font-size:20px;line-height:1;letter-spacing:.06em;text-transform:uppercase;font-weight:300}
.logo .wm b{font-weight:900}.logo .wm .rlp{color:#f2c230;font-size:.54em;letter-spacing:.14em;margin-left:.35em}
.logo .wm .bars{display:flex;margin-top:5px;height:4px;border-radius:2px;overflow:hidden;user-select:none}
.logo .wm .bars i{font-style:normal;color:transparent;height:4px;overflow:hidden}
.logo .wm .bars .k{font-weight:900;background:linear-gradient(90deg,#000 0 68%,#6b1414)}
.logo .wm .bars .r{font-weight:300;background:linear-gradient(90deg,#6b1414,#d62828 28%,#d62828 66%,#e4752c)}
.logo .wm .bars .g{font-size:.54em;letter-spacing:.14em;padding-left:.35em;background:linear-gradient(90deg,#e4752c,#f2c230 45%)}
@media (max-width:360px){.logo .wm{font-size:16px}.logo img{width:28px;height:28px}}
main{max-width:760px;margin:0 auto;padding:16px 16px 48px}nav.pfad{font-size:13px;color:var(--muted);margin-bottom:10px}nav.pfad a{color:var(--muted)}
h1{font-size:26px;line-height:1.25;margin:4px 0 8px;hyphens:auto}h2{font-size:18px;margin:32px 0 10px}p{margin:0 0 12px}
a{color:var(--accent)}.lead{color:var(--muted)}.knopf{display:inline-block;background:#7b2736;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700;margin:8px 0 4px}
ul.liste{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:12px}ul.liste>li{padding:12px 14px;border-top:1px solid var(--line)}ul.liste>li:first-child{border-top:0}
.zeit{font-weight:700}.klein{font-size:14px;color:var(--muted)}ul.themen{margin:6px 0 0;padding-left:18px;font-size:14px}
.spalten{columns:2 220px;column-gap:24px;padding:0;list-style:none}.spalten li{break-inside:avoid;padding:2px 0}
footer{max-width:760px;margin:0 auto;padding:16px;font-size:13px;color:var(--muted)}footer a{color:var(--muted)}`;

function rahmen(o: { titel: string; beschreibung: string; pfad: string; inhalt: string; jsonld?: unknown[] }): string {
  const url = `${SITE}${o.pfad}`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>${esc(o.titel)}</title><meta name="description" content="${esc(o.beschreibung)}"><link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Wahlheimat RLP"><meta property="og:title" content="${esc(o.titel)}">
<meta property="og:description" content="${esc(o.beschreibung)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/img/og.jpg">
<meta property="og:locale" content="de_DE"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#7b2736">
<style>${CSS}</style>${(o.jsonld ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}</head>
<body><header><a class="logo" href="/" aria-label="Wahlheimat – zur Startseite"><img src="/icons/icon.svg" alt="" width="32" height="32"><span class="wm"><span><b>Wahl</b>heimat<b class="rlp">RLP</b></span><span class="bars" aria-hidden="true"><i class="k">Wahl</i><i class="r">heimat</i><i class="g">RLP</i></span></span></a></header><main>${o.inhalt}</main>
<footer>Wahlheimat RLP ist ein unabhängiges, privates Angebot – kein Angebot des Landes oder der Kommunen. Maßgeblich sind die Ratsinformationssysteme der Kommunen.
· <a href="/#/impressum">Impressum</a> · <a href="/#/datenschutz">Datenschutz</a> · <a href="/orte/">Alle Kommunen</a></footer></body></html>`;
}

/** Ortsangaben aus den RIS bereinigen („(siehe Dokument), ,“ → „siehe Dokument“) */
export function ortText(o: string | null): string | null {
  const t = String(o ?? '').replace(/[()]/g, '').split(',').map((x) => x.trim()).filter(Boolean).join(', ');
  return t || null;
}

function sitzungLi(m: SeoSitzung): string {
  const zeit = m.start ? `${datumLang(m.start)}${uhr(m.start) !== '00:00' ? `, ${uhr(m.start)} Uhr` : ''}` : 'Termin offen';
  return `<li><span class="zeit">${esc(zeit)}</span>${m.abgesagt ? ' <strong>(abgesagt)</strong>' : ''}<br>${esc(m.gremium)}${ortText(m.ort) ? `<br><span class="klein">${esc(ortText(m.ort))}</span>` : ''}${m.themen.length ? `<ul class="themen">${m.themen.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</li>`;
}

/** Event-Daten für Suchmaschinen (künftige Sitzungen) */
function eventLd(m: SeoSitzung, k: SeoKoerperschaft, ortName: string, url: string) {
  return {
    '@context': 'https://schema.org', '@type': 'Event',
    name: `${m.gremium} – öffentliche Sitzung`, startDate: m.start,
    eventStatus: m.abgesagt ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: ortText(m.ort) || ortName, address: { '@type': 'PostalAddress', addressLocality: ortName, addressRegion: 'Rheinland-Pfalz', addressCountry: 'DE' } },
    organizer: { '@type': 'GovernmentOrganization', name: k.name },
    isAccessibleForFree: true,
    ...(m.themen.length ? { description: `Tagesordnung u. a.: ${m.themen.join('; ')}` } : {}),
    url,
  };
}

export interface SeoEingabe {
  gebiete: Gebiete;
  /** Gebiet → [Quelle, Körperschaft] wie im Index */
  daten: Record<string, [string, string]>;
  koerperschaft: (quelle: string, body: string) => SeoKoerperschaft | undefined;
  stand: string;
}

/** Schreibt /ort/<pfad>/index.html, /orte/index.html, sitemap.xml und robots.txt; gibt die Zahl der Seiten zurück. */
export function baueSeoSeiten(outDir: string, e: SeoEingabe): number {
  const seiten = seitenListe(e.gebiete);
  const vonId = new Map(seiten.map((s) => [s.id, s]));
  const kinder = new Map<string, Seite[]>(); // VG → Gemeinden, Kreis → VGs und verbandsfreie Gemeinden
  for (const s of seiten) {
    const eltern = s.typ === 'gemeinde' ? s.vg ?? s.kreis : s.typ === 'vg' ? s.kreis : null;
    if (eltern) (kinder.get(eltern) ?? kinder.set(eltern, []).get(eltern)!).push(s);
  }
  const link = (s: Seite) => `<a href="/ort/${s.pfad}/">${esc(s.typ === 'gemeinde' ? s.name : s.titelName)}</a>`;
  const daten = (s: Seite) => e.daten[s.id] ?? (s.art === 'Kreisfreie Stadt' ? e.daten[s.id.slice(0, 5)] : undefined);
  const stand = datumKurz(e.stand);
  const urls: string[] = [`${SITE}/`, `${SITE}/orte/`];

  for (const s of seiten) {
    const pfad = `/ort/${s.pfad}/`;
    const url = `${SITE}${pfad}`;
    const d = daten(s);
    const k = d ? e.koerperschaft(d[0], d[1]) : undefined;
    const vg = s.vg ? vonId.get(s.vg) : undefined;
    const kreis = s.kreis ? vonId.get(s.kreis) : undefined;
    const elternD = vg ? daten(vg) : undefined;
    const naechste = k?.kommend.find((m) => !m.abgesagt);
    const brot = [`<a href="/">Rheinland-Pfalz</a>`, ...(kreis ? [link(kreis)] : []), ...(vg ? [link(vg)] : [])].join(' › ');
    const appLink = `/#/g/${encodeURIComponent(s.art === 'Kreisfreie Stadt' && !e.daten[s.id] && d ? s.id.slice(0, 5) : s.id)}`;

    const kurz = s.name.replace(/^(Verbandsgemeinde|Landkreis) /, '');
    let inhalt = `<nav class="pfad">${brot}</nav><h1>${esc(s.rat)} ${esc(kurz)}: Sitzungen und Tagesordnungen</h1>`;
    let beschreibung: string;
    if (k) {
      inhalt += `<p class="lead">Was beschließt der ${esc(s.rat)} in ${esc(kurz)}? Hier finden Sie die nächsten Sitzungen mit Tagesordnung, die zuletzt beratenen Themen und aktuelle Vorlagen – zusammengestellt aus dem ${k.ohneRis ? 'Internetauftritt' : 'Ratsinformationssystem'} der Kommune.</p>
<a class="knopf" href="${appLink}">In der Wahlheimat-App öffnen</a>`;
      inhalt += `<h2>Nächste Sitzungen</h2>${k.kommend.length ? `<ul class="liste">${k.kommend.map(sitzungLi).join('')}</ul>` : '<p class="klein">Zurzeit sind keine künftigen Sitzungen eingetragen. Neue Termine erscheinen, sobald die Verwaltung sie veröffentlicht.</p>'}`;
      if (k.vergangen.length) inhalt += `<h2>Zuletzt getagt</h2><ul class="liste">${k.vergangen.map(sitzungLi).join('')}</ul>`;
      if (k.vorlagen.length) inhalt += `<h2>Aktuelle Vorlagen</h2><ul class="liste">${k.vorlagen.map((v) => `<li>${esc(v.name)}<br><span class="klein">${[v.art, v.datum ? datumKurz(v.datum) : ''].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul>`;
      if (k.ris) inhalt += `<p class="klein" style="margin-top:16px">Quelle: <a href="${esc(k.ris)}" rel="nofollow noopener">${k.ohneRis ? 'Internetauftritt' : 'Ratsinformationssystem'} der Kommune</a> · Stand ${esc(stand)}</p>`;
      beschreibung = naechste?.start
        ? `Nächste Sitzung: ${naechste.gremium} am ${datumKurz(naechste.start)}. Tagesordnungen, Vorlagen und Beschlüsse für ${s.titelName} übersichtlich auf einen Blick.`
        : `Sitzungen, Tagesordnungen, Vorlagen und Beschlüsse für ${s.titelName} übersichtlich auf einen Blick – aus dem Ratsinformationssystem.`;
    } else {
      const wo = vg && elternD ? `im Ratsinformationssystem der ${esc(vg.titelName)} – <a href="/ort/${vg.pfad}/">dort finden Sie die Sitzungen</a>` : 'noch nicht in Wahlheimat';
      inhalt += `<p class="lead">Die Sitzungen für ${esc(s.titelName)} stehen ${wo}.</p><a class="knopf" href="${appLink}">In der Wahlheimat-App öffnen</a>`;
      beschreibung = `${s.rat}, Sitzungen und Tagesordnungen: ${s.titelName}${vg ? ` (${vg.titelName})` : ''} – Wahlheimat RLP.`;
    }
    const unter = (kinder.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    if (unter.length) inhalt += `<h2>${s.typ === 'vg' ? 'Gemeinden der Verbandsgemeinde' : 'Verbandsgemeinden und Gemeinden im Kreis'}</h2><ul class="spalten">${unter.map((u) => `<li>${link(u)}</li>`).join('')}</ul>`;
    const ebenen = [vg, kreis].filter((x): x is Seite => !!x);
    if (ebenen.length) inhalt += `<h2>Weitere Ebenen</h2><p>${ebenen.map((x) => `${link(x)}`).join(' · ')}</p>`;

    const jsonld: unknown[] = [{
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [{ name: 'Rheinland-Pfalz', item: `${SITE}/` }, ...(kreis ? [{ name: kreis.titelName, item: `${SITE}/ort/${kreis.pfad}/` }] : []),
        ...(vg ? [{ name: vg.titelName, item: `${SITE}/ort/${vg.pfad}/` }] : []), { name: s.titelName, item: url }]
        .map((x, i) => ({ '@type': 'ListItem', position: i + 1, ...x })),
    }];
    if (k) for (const m of k.kommend.slice(0, 5)) if (m.start) jsonld.push(eventLd(m, k, s.name, url));

    mkdirSync(join(outDir, 'ort', s.pfad), { recursive: true });
    writeFileSync(join(outDir, 'ort', s.pfad, 'index.html'), rahmen({
      titel: `${s.rat} ${kurz}: Sitzungen & Tagesordnungen | Wahlheimat RLP`,
      beschreibung, pfad, inhalt, jsonld,
    }));
    urls.push(url);
  }

  // Übersicht aller Kommunen, nach Kreisen
  const kreise = seiten.filter((s) => s.typ === 'kreis').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const kreisfrei = seiten.filter((s) => s.art === 'Kreisfreie Stadt').sort((a, b) => a.name.localeCompare(b.name, 'de'));
  let uebersicht = `<h1>Alle Kommunen in Rheinland-Pfalz</h1><p class="lead">Sitzungen, Tagesordnungen und Vorlagen der Gemeinde- und Stadträte, Verbandsgemeinderäte und Kreistage – nach Kreisen geordnet.</p>
<h2>Kreisfreie Städte</h2><ul class="spalten">${kreisfrei.map((s) => `<li>${link(s)}</li>`).join('')}</ul>`;
  for (const kr of kreise) {
    const vgs = (kinder.get(kr.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    uebersicht += `<h2>${link(kr)}</h2><ul class="spalten">${vgs.map((v) => `<li>${link(v)}</li>`).join('')}</ul>`;
  }
  mkdirSync(join(outDir, 'orte'), { recursive: true });
  writeFileSync(join(outDir, 'orte', 'index.html'), rahmen({
    titel: 'Alle Kommunen in Rheinland-Pfalz: Gemeinderat, Sitzungen & Tagesordnungen | Wahlheimat RLP',
    beschreibung: 'Für jede Gemeinde, Stadt, Verbandsgemeinde und jeden Kreis in Rheinland-Pfalz: nächste Ratssitzungen, Tagesordnungen und Vorlagen.',
    pfad: '/orte/', inhalt: uebersicht,
  }));

  const lastmod = e.stand.slice(0, 10);
  writeFileSync(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /data/\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
  return seiten.length;
}
