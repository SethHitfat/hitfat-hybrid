/* ============================================================
   HITFAT HYBRID · service worker

   Push only. There is deliberately NO fetch handler and no caching: the app is
   one large HTML file that changes several times a day, and a cache that serves
   yesterday's copy is a worse problem than a slow first load — this project has
   been bitten by stale installs on iOS before.

   Its whole job is to be awake when a push arrives and to open the right screen
   when the notification is tapped.
   ============================================================ */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  /* iOS already prints "from Hitfat Hybrid" under every notification, taken from
     the manifest. Repeating the brand as the title says the name twice and buries
     what actually happened, so the event becomes the title and the brand is
     dropped — including for messages sent by an older version of the sender. */
  const brandish = t => !t || /^hitfat( hybrid)?$/i.test(String(t).trim());
  const title = brandish(d.title) ? (d.body || 'HITFAT HYBRID') : d.title;
  const body  = (d.body && d.body !== title) ? d.body : '';
  const opts = {
    body: body,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    tag: d.tag || 'hitfat',
    renotify: false,
    data: { url: d.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // an app already open is focused rather than opened a second time
      if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
        try { await c.navigate(url); } catch (e) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
