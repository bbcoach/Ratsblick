/**
 * Seitenaufrufe aus dem eigenen Zähler (Cloudflare Worker `zaehler/`, Auswertung über `GET /lesen`).
 * Wird nur beim Bauen des Admin-Dashboards abgerufen (Lese-Token als Secret; gesendet wird sein SHA-256-Hash), nie im Browser der Nutzer.
 * Gezählt werden Seitenaufrufe, keine Personen: der Zähler kennt weder IP noch Kennung.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ZaehlerConfig {
  /** Adresse des Workers, z. B. https://wahlheimat-zaehler.<konto>.workers.dev */
  url: string;
  token: string;
}

export interface Zugriffe {
  stand: string;
  tage: Array<{ tag: string; aufrufe: number }>;
  heute: number;
  sieben: number;
  dreissig: number;
  seiten: Array<{ pfad: string; aufrufe: number }>;
  /** Aufrufe nach Seitenart (Startseite, Sitzung, Kommunenseite …), absteigend. */
  arten: Array<{ name: string; aufrufe: number }>;
  /** Aufrufe je Kommune (alle Ebenen zusammengefasst), mit Klarnamen, absteigend. */
  kommunen: Array<{ name: string; aufrufe: number }>;
}

const FESTE_SEITEN: Record<string, string> = {
  '/': 'Startseite (Suche)',
  '/fav': 'Favoriten',
  '/themen': 'Themen',
  '/info': 'Info',
  '/ueber': 'Über Wahlheimat',
  '/impressum': 'Impressum',
  '/datenschutz': 'Datenschutz',
  '/s': 'Sitzung (Einzelansicht)',
  '/v': 'Vorlage (Einzelansicht)',
};

/** Zählerpfad → Seitenart („Kommunenseite“ für /g/…) und ggf. Gebiets-ID. */
export function seitenArt(pfad: string): { art: string; gebiet?: string } {
  const m = /^\/g\/(\d+)(?:\/\w+)?$/.exec(pfad);
  if (m) return { art: 'Kommunenseite', gebiet: m[1] };
  return { art: FESTE_SEITEN[pfad] ?? pfad };
}

/** Klarname eines Gebiets aus data/gebiete-rlp.json (Kreise, Verbandsgemeinden, Gemeinden); sonst die Nummer. */
export function gebietName(id: string, namen: ReadonlyMap<string, string>): string {
  return namen.get(id) ?? `Gebiet ${id}`;
}

export interface ZugriffeFehler {
  fehler: string;
}

export async function holeZugriffe(cfg: ZaehlerConfig, jetzt = new Date(), f: typeof fetch = fetch, namen: ReadonlyMap<string, string> = new Map()): Promise<Zugriffe> {
  const basis = cfg.url.replace(/\/+$/, '');
  const res = await f(`${basis}/lesen?tage=30`, { headers: { authorization: `Bearer ${createHash('sha256').update(cfg.token.trim()).digest('hex')}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`Zähler: HTTP ${res.status}`);
  const d = (await res.json()) as { tage?: Array<{ tag: string; n: number }>; seiten?: Array<{ pfad: string; n: number }> };
  const proTag = new Map((d.tage ?? []).map((t) => [t.tag, t.n]));
  // Tage nach Berliner Datum, damit „heute“ zum Zähler passt
  const berlin = (x: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const tage: Zugriffe['tage'] = [];
  for (let i = 29; i >= 0; i--) {
    const tag = berlin(new Date(jetzt.getTime() - i * 86_400_000));
    tage.push({ tag, aufrufe: proTag.get(tag) ?? 0 });
  }
  const summe = (n: number) => tage.slice(-n).reduce((a, t) => a + t.aufrufe, 0);
  const seiten = (d.seiten ?? []).map((s) => ({ pfad: s.pfad, aufrufe: s.n }));
  const proArt = new Map<string, number>();
  const proKommune = new Map<string, number>();
  for (const s of seiten) {
    const { art, gebiet } = seitenArt(s.pfad);
    proArt.set(art, (proArt.get(art) ?? 0) + s.aufrufe);
    if (gebiet) {
      const n = gebietName(gebiet, namen);
      proKommune.set(n, (proKommune.get(n) ?? 0) + s.aufrufe);
    }
  }
  const absteigend = (m: Map<string, number>) => [...m].map(([name, aufrufe]) => ({ name, aufrufe })).sort((a, b) => b.aufrufe - a.aufrufe || a.name.localeCompare(b.name, 'de'));
  return {
    stand: jetzt.toISOString(),
    tage,
    heute: tage[tage.length - 1]!.aufrufe,
    sieben: summe(7),
    dreissig: summe(30),
    seiten,
    arten: absteigend(proArt),
    kommunen: absteigend(proKommune).slice(0, 20),
  };
}

/** Gebiets-ID → Name für alle Kreise, Verbandsgemeinden und Gemeinden des Landes (aus `data/gebiete-rlp.json`). */
export function gebietNamen(): Map<string, string> {
  const g = JSON.parse(readFileSync(new URL('../../data/gebiete-rlp.json', import.meta.url), 'utf8')) as Record<string, Array<{ id: string; name: string }>>;
  const m = new Map<string, string>();
  for (const liste of [g.kreise, g.verbandsgemeinden, g.gemeinden]) for (const x of liste ?? []) if (!m.has(x.id)) m.set(x.id, x.name);
  return m;
}
