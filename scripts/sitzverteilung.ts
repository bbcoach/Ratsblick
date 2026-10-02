/**
 * Sitzverteilung der Räte nach der Kommunalwahl 2024 aus der Ergebnisseite des Landeswahlleiters
 * (https://www.wahlen.rlp.de/kommunalwahlen/ergebnisse-1 → rlp-kw24.wahlen.23degrees.eu, statische JSON-Dateien).
 * Schreibt data/sitze-2024.json: je amtlichem Gebietsschlüssel (Gemeinde 8-, VG 9-, Kreis 5-stellig) Sitze je Liste.
 *
 * Aufruf: node --import tsx scripts/sitzverteilung.ts   (≈ 2 450 Abrufe, 1 je Sekunde → gut 40 Minuten)
 * Bereits geladene Rohdateien liegen in .cache/kw24/ und werden nicht erneut abgerufen.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASIS = 'https://rlp-kw24.wahlen.23degrees.eu/assets';
const CACHE = '.cache/kw24';
const ZIEL = 'data/sitze-2024.json';
/** --nur-cache: nur bereits geladene Dateien auswerten (zum Testen, ohne Abrufe) */
const NUR_CACHE = process.argv.includes('--nur-cache');
const ZIEL_DATEI = process.argv.find((a) => a.startsWith('--ziel='))?.slice(7);
const UA = 'Wahlheimat/0.1 (vormals Ratsblick; Sitzverteilung Kommunalwahl 2024; Kontakt: https://github.com/bbcoach/Ratsblick)';

interface Knoten { slug: string; name: string; geo_type: 'LAND' | 'LK' | 'VG' | 'VF' | 'GD'; parent: string | null }
interface Partei { id: string; name: string; longName?: string; color?: string }
interface Ergebnis {
  state: string;
  parties: Partei[];
  suggestions: Array<{ id: number; partyId: string }>;
  results: Array<{ geoId: string; seats?: { count: number; last: number | null }; data: Array<{ seats: number | null; seatsLast: number | null; percentage: number | null; suggestionId: number }> }>;
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
let letzter = 0;

async function hole<T>(pfad: string): Promise<T | null> {
  const datei = join(CACHE, pfad.replace(/\//g, '_'));
  if (existsSync(datei)) return JSON.parse(readFileSync(datei, 'utf8')) as T;
  if (NUR_CACHE) return null;
  for (let versuch = 1; versuch <= 5; versuch++) {
    const ab = letzter + 1000 - Date.now();
    if (ab > 0) await warte(ab);
    letzter = Date.now();
    try {
      const res = await fetch(`${BASIS}/${pfad}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
      // Unbekannte Dateien liefern die Startseite der App (HTML) statt 404-JSON
      if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      writeFileSync(datei, text);
      return JSON.parse(text) as T;
    } catch (e) {
      if (versuch === 5) throw e;
      await warte(2000 * versuch);
    }
  }
  return null;
}

/** Wahl-ID je Ebene; kreisfreie Städte stehen im Baum als LK mit „Kreisfreie Stadt“ im Namen. */
function wahlVon(k: Knoten): string | null {
  if (k.geo_type === 'LK') return k.name.includes('Kreisfreie Stadt') ? 'KS_STADTRATSWAHL' : 'LK_KREISTAGSWAHL';
  return { VG: 'VG_VERBANDSGEMEINDERATSWAHL', VF: 'VF_VERBANDSFREIEGEMEINDERATSWAHL', GD: 'GD_GEMEINDERATSWAHL' }[k.geo_type as 'VG'] ?? null;
}

const RAT: Record<string, string> = {
  LK_KREISTAGSWAHL: 'Kreistag', KS_STADTRATSWAHL: 'Stadtrat', VG_VERBANDSGEMEINDERATSWAHL: 'Verbandsgemeinderat',
  VF_VERBANDSFREIEGEMEINDERATSWAHL: 'Gemeinderat', GD_GEMEINDERATSWAHL: 'Gemeinderat',
};

/** Geo-ID (KKK VV GGG 00) → amtlicher Schlüssel; VGs über ihre Gemeinden (die VG-Nummer weicht ab). */
function gemeindeSchluessel(slug: string) { return '07' + slug.slice(0, 3) + slug.slice(5, 8); }

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const baum = (await hole<Knoten[]>('wahlen-vec-tree.json'))!;
  const parteien = (await hole<Partei[]>('parties.json'))!;
  const gebiete = JSON.parse(readFileSync('data/gebiete-rlp.json', 'utf8')) as {
    gemeinden: Array<{ id: string; name: string; art: string; vg?: string | null }>;
  };
  const vgVonGemeinde = new Map(gebiete.gemeinden.map((g) => [g.id, g.vg ?? null]));
  const gemeindeIds = new Set(gebiete.gemeinden.map((g) => g.id));

  const raete: Record<string, unknown> = {};
  const knoten = baum.filter((k) => wahlVon(k));
  let n = 0;
  for (const k of knoten) {
    const wahl = wahlVon(k)!;
    n++;
    if (n % 100 === 0) console.log(`${n}/${knoten.length} …`);
    const e = await hole<Ergebnis>(`json/wahlen/${wahl}/${k.slug}.json`);
    if (!e) { if (!NUR_CACHE) console.warn(`keine Daten: ${k.name} (${wahl})`); continue; }

    let schluessel: string | undefined;
    if (k.geo_type === 'LK') schluessel = '07' + k.slug.slice(0, 3);
    else if (k.geo_type === 'GD' || k.geo_type === 'VF') schluessel = gemeindeSchluessel(k.slug);
    else {
      const kind = baum.find((x) => x.parent === k.slug && x.geo_type === 'GD');
      schluessel = kind ? vgVonGemeinde.get(gemeindeSchluessel(kind.slug)) ?? undefined : undefined;
    }
    if (!schluessel) { console.warn(`kein Schlüssel: ${k.name}`); continue; }
    if ((k.geo_type === 'GD' || k.geo_type === 'VF') && !gemeindeIds.has(schluessel)) console.warn(`unbekannte Gemeinde ${schluessel} ${k.name}`);

    const r = e.results.find((x) => x.geoId === k.slug);
    const eintrag: Record<string, unknown> = { rat: RAT[wahl] };
    if (!r || !r.data.length || e.state.startsWith('RELATION_PRESTART')) {
      eintrag.mehrheitswahl = true; // nur eine oder keine Liste: Mehrheitswahl, keine Sitze nach Listen
    } else {
      const vorschlag = new Map(e.suggestions.map((s) => [s.id, s.partyId]));
      const lokal = new Map(e.parties.map((p) => [p.id, p]));
      eintrag.sitze = r.seats?.count ?? r.data.reduce((a, d) => a + (d.seats ?? 0), 0);
      eintrag.listen = r.data
        .filter((d) => (d.seats ?? 0) > 0 || (d.seatsLast ?? 0) > 0)
        .map((d) => {
          const pid = vorschlag.get(d.suggestionId) ?? '';
          const p = lokal.get(pid);
          // Landesweite Parteien (CDU, SPD …) über ihre ID, Wählergruppen mit Namen
          return p ? [p.name, d.seats ?? 0, d.percentage, d.seatsLast, p.longName ?? null] : [`#${pid}`, d.seats ?? 0, d.percentage, d.seatsLast, null];
        })
        .sort((a, b) => (b[1] as number) - (a[1] as number));
    }
    raete[schluessel] = eintrag;
  }

  const p: Record<string, { name: string; lang?: string; farbe?: string }> = {};
  for (const x of parteien) p[x.id] = { name: x.name, lang: x.longName, farbe: x.color };
  writeFileSync(ZIEL_DATEI ?? ZIEL, JSON.stringify({
    quelle: 'Landeswahlleiter Rheinland-Pfalz, Kommunalwahlen 2024 (wahlen.rlp.de)',
    wahl: '2024-06-09',
    parteien: p,
    raete,
  }) + '\n');
  console.log(`✓ ${Object.keys(raete).length} Räte → ${ZIEL_DATEI ?? ZIEL}`);
}

await main();
