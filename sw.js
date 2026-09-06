// BlinkLoop Team service worker: notifications only. No caching on purpose,
// so a deploy is always what people see.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Pass-through fetch handler: older Android Chrome only offers "Install app" when the
// service worker has one. It never intercepts, so every request still goes to the network.
self.addEventListener('fetch', () => {});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // A focused team tab already shows the message in the feed; stay quiet.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (d.tag !== 'bl-test' && wins.some(c => c.focused && /\/team/.test(c.url))) return;
    await self.registration.showNotification(d.title || 'BlinkLoop Team', {
      body: d.body || 'New message',
      icon: '/assets/icon-192.png',
      badge: '/assets/badge-96.png',
      tag: d.tag || 'bl-team',
      renotify: true,
      data: { url: d.url || '/team' }
    });
    if (self.navigator.setAppBadge) { try { await self.navigator.setAppBadge(); } catch (_) {} }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/team';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find(c => /\/team/.test(c.url));
    if (open) {
      await open.focus();
      if ('navigate' in open && !open.url.endsWith(url)) { try { await open.navigate(url); } catch (_) {} }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
