// Offline support. Same-origin GET only; nothing about the visitor is stored here.
const VERSION = 'island-v13';
// the folder the site lives in ("/" or "/Sri-Lanka/" on GitHub Pages): everything is relative to this file
const BASE = new URL('./', self.location).pathname;
const SHELL = ['', 'manifest.webmanifest', 'favicon.svg', 'terrain/height.png', 'terrain/relief.webp', 'terrain/satellite.webp', 'terrain/satellite-sm.webp', 'noscript.css'].map((p) => BASE + p);
const IMG_LIMIT = 420;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VERSION + '-img').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(cache) { const keys = await cache.keys(); for (let i = 0; i < keys.length - IMG_LIMIT; i++) await cache.delete(keys[i]); }
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(BASE, copy)); return r; }).catch(() => caches.match(BASE)));
    return;
  }
  if (!url.pathname.startsWith(BASE)) return;
  const path = url.pathname.slice(BASE.length);
  const isImg = path.startsWith('img/') || path.startsWith('tiles/');
  if (isImg || path.startsWith('assets/') || path.startsWith('terrain/') || path.startsWith('icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(isImg ? VERSION + '-img' : VERSION).then((c) => c.put(req, copy).then(() => isImg && trim(c))); }
      return r;
    })));
  }
});
