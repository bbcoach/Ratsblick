// Wahlheimat – Service Worker.
// App-Hülle: sofort aus dem Cache, im Hintergrund aktualisiert (neue Version → neuer Service Worker → App lädt neu).
// Daten: je Build unveränderlich (jeder Abgleich baut einen neuen Service Worker mit neuer VERSION), daher direkt aus dem
// Cache dieses Builds; nur beim ersten Abruf aus dem Netz. Ein neuer Build bekommt einen neuen, leeren Datencache.
const VERSION = '__BUILD__';
const APP_VERSION = '__APP__'; // Inhalt der App-Dateien; gleich bleibend, wenn sich nur die Daten geändert haben
const SHELL = `ratsblick-app-${APP_VERSION}`;
const DATA = `ratsblick-daten-${VERSION}`;
const APP = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'fonts/public-sans-latin.woff2', 'fonts/nunito-latin.woff2', 'fonts/ibm-plex-mono-400-latin.woff2', 'fonts/ibm-plex-mono-500-latin.woff2'];

self.addEventListener('install', (e) => {
  // App-Hülle nur neu laden, wenn sich der Code geändert hat (sonst ist sie schon im Cache)
  e.waitUntil(caches.open(SHELL).then(async (c) => { if (!(await c.match('app.js'))) await c.addAll(APP); }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => (k.startsWith('ratsblick-app-') && k !== SHELL) || (k.startsWith('ratsblick-daten') && k !== DATA) || k === 'ratsblick-schriften')
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Die Seite fragt nach einem Wechsel, ob sich der Code geändert hat (sonst kein Neuladen nötig)
self.addEventListener('message', (e) => { if (e.data === 'app-version') e.ports[0]?.postMessage(APP_VERSION); });

/** Daten: Cache dieses Builds, sonst Netz (und merken); ohne Netz notfalls ein älterer Stand aus irgendeinem Cache */
async function daten(req) {
  const cache = await caches.open(DATA);
  const key = req.url.split('?')[0];
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    const alt = await caches.match(key);
    if (!alt) throw new Error('offline und nicht im Cache');
    const headers = new Headers(alt.headers);
    headers.set('x-ratsblick-cache', 'offline');
    return new Response(alt.body, { status: alt.status, headers });
  }
}

/** App-Hülle: sofort aus dem Cache, gleichzeitig aus dem Netz nachladen und den Cache auffrischen */
async function huelle(e, req, cacheKey) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(cacheKey, { ignoreSearch: true });
  const netz = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(cacheKey, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(netz.catch(() => {}));
    return hit;
  }
  return netz.catch(() => Response.error());
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/admin')) return; // verschlüsselte Admin-Seite: immer direkt aus dem Netz, nie aus dem Cache
  if (url.pathname.endsWith('/sw.js')) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(daten(req));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(huelle(e, req, 'index.html'));
    return;
  }
  e.respondWith(huelle(e, req, req));
});
