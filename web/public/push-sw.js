// ARCA · Service worker solo para notificaciones push (Firebase Cloud Messaging).
// Va aparte del de modo sin conexión (sw.js) y con su propio alcance (/push/),
// así no cambia cómo carga la aplicación.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Llega un aviso aunque ARCA esté cerrada: se muestra como notificación del celular
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { data: { title: 'ARCA', body: event.data ? event.data.text() : '' } };
  }
  const data = payload.data || {};
  const fallback = payload.notification || {};
  event.waitUntil(self.registration.showNotification(data.title || fallback.title || 'ARCA', {
    body: data.body || fallback.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || undefined, // un mismo aviso no se repite
    requireInteraction: data.level === 'critico', // las alertas críticas se quedan en pantalla
    data: { url: data.url || '/' },
  }));
});

// Al tocar la notificación se abre (o se enfoca) ARCA
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
