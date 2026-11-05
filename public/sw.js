// Caches only the static app shell. API responses are never cached (they carry personal data).
const CACHE = 'mehrpol-v3';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/theme.js', '/fonts/Vazirmatn.woff2', '/icons/logo.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/payment/') || url.pathname.startsWith('/download/')) return;
  // Network first so updates show immediately; cache is the offline fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r ?? caches.match('/'))));
});
