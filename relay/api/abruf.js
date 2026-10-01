// Ratsblick – Weiterleiter für Ratsinformationssysteme, die nur aus Europa erreichbar sind.
// Läuft als Vercel-Funktion in Frankfurt (vercel.json: regions fra1).
//
// Aufruf:  GET /api/abruf?url=<Adresse>   mit Kopfzeile  Authorization: Bearer <RELAY_SCHLUESSEL>
// Umgebung: RELAY_SCHLUESSEL (Pflicht), RELAY_HOSTS (kommagetrennt, erlaubte Hosts)
//
// Kein offener Proxy: nur GET, nur freigegebene Hosts, nur mit Schlüssel, keine Weiterleitung auf fremde Hosts.

const UA = 'Ratsblick/0.1 (OParl-Abgleich; Kontakt: https://github.com/bbcoach/Ratsblick)';
const STANDARD_HOSTS = 'ris.kaiserslautern.de';

function antwort(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-ratsblick-relay': 'fehler' } });
}

/** Vergleicht Schlüssel in konstanter Zeit. */
function gleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function abruf(request, env = process.env, fetchImpl = fetch) {
  const schluessel = env.RELAY_SCHLUESSEL;
  if (!schluessel || schluessel.length < 20) return antwort(500, 'RELAY_SCHLUESSEL fehlt oder ist zu kurz');
  const auth = request.headers.get('authorization') || '';
  if (!gleich(auth, `Bearer ${schluessel}`)) return antwort(401, 'Schlüssel fehlt oder ist falsch');

  const ziel = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(ziel); } catch { return antwort(400, 'Parameter url fehlt oder ist ungültig'); }
  const erlaubt = (env.RELAY_HOSTS || STANDARD_HOSTS).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!['http:', 'https:'].includes(url.protocol) || !erlaubt.includes(url.hostname.toLowerCase())) {
    return antwort(403, `Host nicht freigegeben: ${url.hostname}`);
  }

  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: request.headers.get('accept') || '*/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    // Node meldet nur „fetch failed“; die eigentliche Ursache (TLS, DNS, Zeitüberschreitung) steckt in err.cause
    const c = err.cause;
    const ursache = c ? ` (${[c.code, c.message].filter(Boolean).join(': ')})` : '';
    return antwort(502, `Abruf fehlgeschlagen: ${err.message}${ursache}`);
  }
  const headers = new Headers({ 'x-ratsblick-relay': 'ok' });
  for (const h of ['content-type', 'last-modified', 'etag']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Weiterleitungen nur innerhalb der freigegebenen Hosts melden, nicht selbst folgen
  const loc = res.headers.get('location');
  if (loc) headers.set('x-ratsblick-location', new URL(loc, url).toString());
  return new Response(res.body, { status: res.status, headers });
}

export function GET(request) {
  return abruf(request);
}
