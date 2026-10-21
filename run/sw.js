/* HITFAT RUN CLUB · service worker (scope /run/)

   Network first for the app's own files, falling back to the last copy when
   offline, so a new deploy is picked up on the next open and an old one is
   never pinned (the Hybrid app learned that the hard way on iOS).
   Pinned CDN libraries are cache first: their URLs never change content.
   Supabase requests are never cached: data must be live or clearly absent. */
const VERSION = 'hfrun-v1';
const SHELL = ['/run/', '/run/index.html', '/run/app.css', '/run/manifest.json',
  '/run/js/main.js', '/run/js/api.js', '/run/js/i18n.js', '/run/js/ui.js', '/run/js/stats.js', '/run/js/achievements.js', '/run/js/gps.js',
  '/run/js/views/auth.js', '/run/js/views/onboarding.js', '/run/js/views/home.js', '/run/js/views/training.js', '/run/js/views/programs.js',
  '/run/js/views/workout.js', '/run/js/views/log.js', '/run/js/views/club.js', '/run/js/views/profile.js', '/run/js/views/gps.js',
  '/icon-192.png', '/favicon-32.png'];
const PINNED = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.45\.4|cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4|fonts\.(googleapis|gstatic)\.com)\//;

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hfrun-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (PINNED.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
    return;
  }
  if (url.origin !== location.origin || !(url.pathname.startsWith('/run/') || SHELL.includes(url.pathname))) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/run/index.html') : Response.error()))));
});
