/**
 * Seitenaufrufe aus dem eigenen Zähler (Cloudflare Worker `zaehler/`, Auswertung über `GET /lesen`).
 * Wird nur beim Bauen des Admin-Dashboards abgerufen (Lese-Token als Secret; gesendet wird sein SHA-256-Hash), nie im Browser der Nutzer.
 * Gezählt werden Seitenaufrufe, keine Personen: der Zähler kennt weder IP noch Kennung.
 */
import { createHash } from 'node:crypto';

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
}

export interface ZugriffeFehler {
  fehler: string;
}

export async function holeZugriffe(cfg: ZaehlerConfig, jetzt = new Date(), f: typeof fetch = fetch): Promise<Zugriffe> {
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
  return {
    stand: jetzt.toISOString(),
    tage,
    heute: tage[tage.length - 1]!.aufrufe,
    sieben: summe(7),
    dreissig: summe(30),
    seiten: (d.seiten ?? []).map((s) => ({ pfad: s.pfad, aufrufe: s.n })),
  };
}
