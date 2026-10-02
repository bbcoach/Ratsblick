// Ratsblick – Weiterleiter für Ratsinformationssysteme, die nur aus Europa erreichbar sind.
// Läuft als Vercel-Funktion in Frankfurt (vercel.json: regions fra1).
//
// Aufruf:  GET /api/abruf?url=<Adresse>   mit Kopfzeile  Authorization: Bearer <RELAY_SCHLUESSEL>
// Umgebung: RELAY_SCHLUESSEL (Pflicht), RELAY_HOSTS (kommagetrennt, erlaubte Hosts)
//
// Kein offener Proxy: nur GET, nur freigegebene Hosts, nur mit Schlüssel, keine Weiterleitung auf fremde Hosts.

import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { Readable } from 'node:stream';
import tls from 'node:tls';
import { ERLAUBT } from '../lib/erlaubt.js';

const UA = 'Wahlheimat/0.1 (vormals Ratsblick; Abgleich oeffentlicher Ratsinformationen; Kontakt: https://github.com/bbcoach/Ratsblick)';
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

// ---------- Unvollständige Zertifikatsketten ----------
// Manche Server schicken ihr Zwischenzertifikat nicht mit. Browser laden es über die im Zertifikat
// genannte Adresse („CA Issuers“, AIA) nach – das tun wir hier auch. Die Prüfung bleibt vollständig:
// Das nachgeladene Zertifikat muss selbst zu einer der normalen Wurzelzertifikate führen.
const zwischenCache = new Map(); // Host → PEM-Liste

function laden(url, tiefe = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: 10_000, headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && tiefe < 3) {
        res.resume();
        resolve(laden(new URL(res.headers.location, url).toString(), tiefe + 1));
        return;
      }
      const teile = [];
      res.on('data', (d) => teile.push(d));
      res.on('end', () => resolve(Buffer.concat(teile)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung beim Laden des Zwischenzertifikats')));
    req.on('error', reject);
  });
}

/** Liest nur das Serverzertifikat (ohne Daten auszutauschen) und lädt dessen Aussteller-Zertifikate. */
async function zwischenzertifikate(host, port) {
  if (zwischenCache.has(host)) return zwischenCache.get(host);
  const cert = await new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      resolve(c);
    });
    sock.on('timeout', () => sock.destroy(new Error('Zeitüberschreitung beim TLS-Verbindungsaufbau')));
    sock.on('error', reject);
  });
  const urls = cert?.infoAccess?.['CA Issuers - URI'] ?? [];
  const pems = [];
  for (const u of urls) {
    const daten = await laden(u);
    const text = daten.toString('latin1');
    pems.push(text.includes('-----BEGIN CERTIFICATE-----') ? text : new X509Certificate(daten).toString());
  }
  zwischenCache.set(host, pems);
  return pems;
}

/** GET mit zusätzlichen Zwischenzertifikaten; Ergebnis als Web-Response. */
async function abrufMitKette(url, headers) {
  const port = Number(url.port) || 443;
  const ca = [...tls.rootCertificates, ...(await zwischenzertifikate(url.hostname, port))];
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca, headers, timeout: 25_000 }, (res) => {
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: h }));
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

const KETTE_FEHLT = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

export async function abruf(request, env = process.env, fetchImpl = fetch) {
  const schluessel = env.RELAY_SCHLUESSEL;
  if (!schluessel || schluessel.length < 20) return antwort(500, 'RELAY_SCHLUESSEL fehlt oder ist zu kurz');
  const auth = request.headers.get('authorization') || '';
  if (!gleich(auth, `Bearer ${schluessel}`)) return antwort(401, 'Schlüssel fehlt oder ist falsch');

  const ziel = new URL(request.url).searchParams.get('url');
  let url;
  try { url = new URL(ziel); } catch { return antwort(400, 'Parameter url fehlt oder ist ungültig'); }
  const erlaubt = [...ERLAUBT, ...(env.RELAY_HOSTS || STANDARD_HOSTS).split(',')].map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!['http:', 'https:'].includes(url.protocol) || !erlaubt.includes(url.hostname.toLowerCase())) {
    return antwort(403, `Host nicht freigegeben: ${url.hostname}`);
  }

  const kopf = { 'User-Agent': UA, Accept: request.headers.get('accept') || '*/*' };
  // Für zustandsbehaftete Oberflächen (ALLRIS 4/Wicket): Sitzungs-Cookie und Ajax-Kennzeichen durchreichen
  const cookie = request.headers.get('x-ratsblick-cookie');
  if (cookie) kopf.Cookie = cookie;
  for (const h of ['wicket-ajax', 'wicket-ajax-baseurl', 'x-requested-with']) {
    const v = request.headers.get(h);
    if (v) kopf[h] = v;
  }
  let res;
  try {
    try {
      res = await fetchImpl(url, { headers: kopf, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      if (!KETTE_FEHLT.has(err?.cause?.code) || url.protocol !== 'https:') throw err;
      res = await abrufMitKette(url, kopf);
    }
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
  // Set-Cookie nicht als Cookie des Weiterleiters setzen, sondern in eigener Kopfzeile zurückgeben
  const gesetzt = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  if (gesetzt.length) headers.set('x-ratsblick-set-cookie', gesetzt.map((c) => c.split(';')[0]).join('; '));
  // Weiterleitungen nur innerhalb der freigegebenen Hosts melden, nicht selbst folgen
  const loc = res.headers.get('location');
  if (loc) headers.set('x-ratsblick-location', new URL(loc, url).toString());
  return new Response(res.body, { status: res.status, headers });
}

export function GET(request) {
  return abruf(request);
}
