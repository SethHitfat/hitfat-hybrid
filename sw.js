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
  /* The bold line is the name, in the case the brand is actually written in, and
     what happened sits beneath it. iOS adds its own "from" line from the
     manifest's short_name, which is why that is set to HITFAT rather than the
     same words again.

     The sender has been through two shapes — brand as title with the event in
     the body, and the event as title — so the message is worked out from
     whichever arrives, and neither version needs redeploying to read correctly. */
  const brandish = t => !t || /^hitfat( hybrid)?$/i.test(String(t).trim());
  const message = brandish(d.title)
        ? (d.body || '')
        : (d.body && d.body !== d.title
             ? String(d.title).replace(/[.:;,\s]+$/, '') + '. ' + d.body
             : d.title);
  const title = 'Hitfat Hybrid';
  const body  = message;
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
