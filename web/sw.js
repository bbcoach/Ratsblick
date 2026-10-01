// Ratsblick – Service Worker. App-Hülle aus dem Cache, Daten zuerst aus dem Netz (offline: letzter Stand).
const VERSION = '__BUILD__';
const SHELL = `ratsblick-app-${VERSION}`;
const DATA = 'ratsblick-daten';
const FONTS = 'ratsblick-schriften';
const APP = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ratsblick-app-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (!hit) throw new Error('offline und nicht im Cache');
    const headers = new Headers(hit.headers);
    headers.set('x-ratsblick-cache', 'offline');
    return new Response(hit.body, { status: hit.status, headers });
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html', { cacheName: SHELL })));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: SHELL }).then((hit) => hit || fetch(req)));
});
