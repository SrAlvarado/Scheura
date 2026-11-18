// Importado por el service worker generado (vite.config.ts → workbox.importScripts).
// - push: muestra los avisos que envía el servidor (Web Push), aunque la app esté cerrada.
// - notificationclick: abre la app en la pantalla del aviso al tocar la notificación.
// - pushsubscriptionchange: intenta renovar la suscripción y avisa a la app para que la registre en el servidor.

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Scheura';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || '' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL('./' + ((event.notification.data && event.notification.data.url) || ''), self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const resubscribe = old && old.options && old.options.applicationServerKey
    ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey }).catch(() => null)
    : Promise.resolve(null);
  event.waitUntil(
    resubscribe
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((list) => list.forEach((c) => c.postMessage({ type: 'scheura:pushsubscriptionchange' }))),
  );
});
