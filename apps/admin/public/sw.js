/* global self */
// Owner-desk service worker: shows new-order and quote alerts even when the desk is closed.
// It deliberately caches nothing, so the desk never shows stale orders or prices.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/today';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'शिव सीमेंट स्टोर', {
        body: data.body || 'नया काम आया है।',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || 'shiv-owner-work',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 400],
        data: { url },
      });
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) client.postMessage({ type: 'shiv-owner-push' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/today', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        await client.focus();
        return client.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
