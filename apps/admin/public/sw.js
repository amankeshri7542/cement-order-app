/* global self */
// Owner-desk service worker: shows new-order and quote alerts even when the desk is closed.
// It deliberately caches nothing, so the desk never shows stale orders or prices.
const api = new URL(self.location.href).searchParams.get('api') || '';
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
      await self.registration.showNotification(data.title || 'Shiv Cement Desk', {
        body: data.body || 'Naya kaam aaya hai.',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || 'shiv-owner-work',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 400],
        // One tap only for a card with nothing to read. Everything else opens the card.
        actions:
          typeof data.confirmToken === 'string'
            ? [
                { action: 'confirm', title: 'Pakka karo' },
                { action: 'open', title: 'Dekho' },
              ]
            : [{ action: 'open', title: 'Dekho' }],
        data: {
          url,
          tag: data.tag || 'shiv-owner-work',
          confirmToken: typeof data.confirmToken === 'string' ? data.confirmToken : null,
        },
      });
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) client.postMessage({ type: 'shiv-owner-push' });
      // Tells the shop this phone really showed the alert. It needs no session, and a failure
      // here never affects the alert already on screen.
      if (typeof data.ack === 'string' && /^https?:\/\//.test(api))
        await fetch(`${api}/admin/push/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ token: data.ack }),
        }).catch(() => undefined);
    })(),
  );
});

/** A button's token stands in for a session, so this works with the desk closed. */
async function pushAction(token) {
  if (!token || !/^https?:\/\//.test(api)) return null;
  try {
    const response = await fetch(`${api}/admin/push/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ token }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.url || '/today', self.location.origin).href;
  event.waitUntil(
    (async () => {
      if (event.action === 'confirm') {
        const done = await pushAction(data.confirmToken);
        if (done) {
          await self.registration.showNotification('Pakka ho gaya.', {
            body: 'Message 10 second mein jayega.',
            icon: '/icon-192.png',
            badge: '/badge-96.png',
            tag: data.tag,
            actions: [{ action: 'undo', title: 'Wapas lo' }],
            data: { url: data.url, tag: data.tag, undoToken: done.undoToken },
          });
          return undefined;
        }
      }
      if (event.action === 'undo') {
        const done = await pushAction(data.undoToken);
        if (done) {
          await self.registration.showNotification('Wapas le liya.', {
            body: 'Grahak ko kuch nahi gaya.',
            icon: '/icon-192.png',
            badge: '/badge-96.png',
            tag: data.tag,
            actions: [{ action: 'open', title: 'Dekho' }],
            data: { url: data.url, tag: data.tag },
          });
          return undefined;
        }
      }
      // A failed button, or a plain tap, opens the card to see what is true now.
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
