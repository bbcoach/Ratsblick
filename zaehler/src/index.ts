/**
 * Wahlheimat – eigener Seitenaufruf-Zähler (Cloudflare Worker + D1).
 *
 * Speichert je Tag und Seitenart nur eine Zahl: „am 2026-10-03 wurde /g/07134005/vg 12-mal aufgerufen“.
 * Keine IP-Adresse, kein Hash, keine Kennung, keine Cookies, kein Verweis, kein User-Agent wird gespeichert.
 *
 *   POST /z       Text-Body = Seitenart (z. B. /g/07134005/vg), von wahlheimat-rlp.de per sendBeacon
 *   GET  /lesen   Auswertung der letzten Tage, nur mit „Bearer <SHA-256-Hex des Lese-Tokens>“ (Secret LESE_TOKEN)
 */

// Minimale Typen für D1 (reicht für diesen Worker, ohne @cloudflare/workers-types)
interface D1Stmt {
  bind(...werte: unknown[]): D1Stmt;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface Env {
  DB: { prepare(sql: string): D1Stmt };
  LESE_TOKEN?: string;
  /** erlaubte Herkunft, Standard: https://wahlheimat-rlp.de */
  ERLAUBTE_HERKUNFT?: string;
}

const STANDARD_HERKUNFT = 'https://wahlheimat-rlp.de';
const MAX_TAGE = 365;
const AUFBEWAHRUNG_TAGE = 400;

/** Erlaubte Seitenarten: nur die Routen der App, nie Suchbegriffe oder Sitzungs-/Vorlagen-IDs. */
export function gueltigerPfad(p: string): boolean {
  return (
    p === '/' ||
    /^\/(fav|themen|info|ueber|impressum|datenschutz|s|v)$/.test(p) ||
    /^\/g\/\d{5,9}(\/(gemeinde|stadt|vg|kreis))?$/.test(p)
  );
}

export function berlinTag(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const bot = (ua: string) => /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|python-requests/i.test(ua);

function antwort(status: number, koerper: unknown, herkunft: string | null): Response {
  const h: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (herkunft) {
    h['access-control-allow-origin'] = herkunft;
    h['vary'] = 'Origin';
  }
  return new Response(koerper === null ? null : JSON.stringify(koerper), { status, headers: h });
}

/** SHA-256 des Tokens als Hex (reines ASCII, damit Umlaute und Sonderzeichen im Token nicht an der Header-Kodierung scheitern). */
export async function tokenHash(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.trim()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vergleich in konstanter Zeit, damit das Token nicht über die Antwortzeit erraten werden kann. */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const erlaubt = env.ERLAUBTE_HERKUNFT ?? STANDARD_HERKUNFT;

    if (url.pathname === '/') return antwort(200, { ok: true, service: 'wahlheimat-zaehler' }, null);

    if (url.pathname === '/z') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { 'access-control-allow-origin': erlaubt, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
      }
      if (request.method !== 'POST') return antwort(405, { fehler: 'nur POST' }, null);
      // Nur Aufrufe von der eigenen Seite zählen; alles andere stillschweigend verwerfen (kein Hinweis für Angreifer)
      if (request.headers.get('origin') !== erlaubt) return antwort(204, null, null);
      if (bot(request.headers.get('user-agent') ?? '')) return antwort(204, null, erlaubt);
      const pfad = (await request.text()).slice(0, 80).trim();
      if (!gueltigerPfad(pfad)) return antwort(204, null, erlaubt);
      await env.DB.prepare('INSERT INTO zaehler (tag, pfad, n) VALUES (?, ?, 1) ON CONFLICT (tag, pfad) DO UPDATE SET n = n + 1').bind(berlinTag(), pfad).run();
      return antwort(204, null, erlaubt);
    }

    if (url.pathname === '/lesen') {
      const token = (env.LESE_TOKEN ?? '').trim();
      const gegeben = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      if (!token || !gleich(gegeben, await tokenHash(token))) return antwort(401, { fehler: 'nicht berechtigt' }, null);
      const tage = Math.min(MAX_TAGE, Math.max(1, Number(url.searchParams.get('tage')) || 30));
      const ab = berlinTag(new Date(Date.now() - (tage - 1) * 86_400_000));
      const proTag = await env.DB.prepare('SELECT tag, SUM(n) AS n FROM zaehler WHERE tag >= ? GROUP BY tag ORDER BY tag').bind(ab).all<{ tag: string; n: number }>();
      const seiten = await env.DB.prepare('SELECT pfad, SUM(n) AS n FROM zaehler WHERE tag >= ? GROUP BY pfad ORDER BY n DESC LIMIT 15').bind(ab).all<{ pfad: string; n: number }>();
      return antwort(200, { ab, tage: proTag.results, seiten: seiten.results }, null);
    }

    return antwort(404, { fehler: 'unbekannt' }, null);
  },

  /** Täglich: alte Zeilen löschen (Aufbewahrung 400 Tage). */
  async scheduled(_ereignis: unknown, env: Env): Promise<void> {
    const grenze = berlinTag(new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000));
    await env.DB.prepare('DELETE FROM zaehler WHERE tag < ?').bind(grenze).run();
  },
};
