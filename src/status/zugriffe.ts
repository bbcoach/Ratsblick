/**
 * Zugriffszahlen aus GoatCounter (https://www.goatcounter.com/api): Besucher je Tag, meistaufgerufene App-Seiten und Verweisseiten.
 * Wird nur beim Bauen des Admin-Dashboards abgerufen (Token als Secret), nie im Browser der Nutzer.
 * „Besucher“ sind bei GoatCounter einzigartige Besuche je Tag und Seite, keine Personen.
 */
export interface ZaehlerConfig {
  /** Adresse der Seite bei GoatCounter, z. B. https://wahlheimat.goatcounter.com */
  url: string;
  token: string;
}

export interface Zugriffe {
  stand: string;
  tage: Array<{ tag: string; besucher: number }>;
  heute: number;
  sieben: number;
  dreissig: number;
  seiten: Array<{ pfad: string; besucher: number }>;
  verweise: Array<{ name: string; besucher: number }>;
}

export interface ZugriffeFehler {
  fehler: string;
}

const stunde = (d: Date) => `${d.toISOString().slice(0, 13)}:00:00Z`;

export async function holeZugriffe(cfg: ZaehlerConfig, jetzt = new Date(), f: typeof fetch = fetch): Promise<Zugriffe> {
  const basis = cfg.url.replace(/\/(count)?\/?$/, '');
  const ende = new Date(jetzt.getTime() + 3600_000);
  const start = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() - 29));
  const q = `start=${encodeURIComponent(stunde(start))}&end=${encodeURIComponent(stunde(ende))}`;
  const get = async <T>(pfad: string): Promise<T> => {
    const res = await f(`${basis}/api/v0/${pfad}`, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`GoatCounter ${pfad.split('?')[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  // Höchstens 4 Anfragen pro Sekunde erlaubt: nacheinander
  const gesamt = await get<{ stats?: Array<{ day: string; daily?: number; hourly?: number[] }> }>(`stats/total?${q}`);
  const hits = await get<{ hits?: Array<{ path: string; count: number }> }>(`stats/hits?${q}&limit=15`);
  const refs = await get<{ stats?: Array<{ name: string; count: number }> }>(`stats/toprefs?${q}&limit=10`);

  const proTag = new Map<string, number>();
  for (const s of gesamt.stats ?? []) proTag.set(s.day.slice(0, 10), s.daily ?? (s.hourly ?? []).reduce((a, b) => a + b, 0));
  const tage: Zugriffe['tage'] = [];
  for (let i = 0; i < 30; i++) {
    const tag = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    tage.push({ tag, besucher: proTag.get(tag) ?? 0 });
  }
  const summe = (n: number) => tage.slice(-n).reduce((a, t) => a + t.besucher, 0);
  return {
    stand: jetzt.toISOString(),
    tage,
    heute: tage[tage.length - 1]!.besucher,
    sieben: summe(7),
    dreissig: summe(30),
    seiten: (hits.hits ?? []).map((h) => ({ pfad: h.path, besucher: h.count })),
    verweise: (refs.stats ?? []).filter((r) => r.name).map((r) => ({ name: r.name, besucher: r.count })),
  };
}
