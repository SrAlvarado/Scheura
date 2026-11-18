// Importado por el service worker generado: abre la app en la pantalla del aviso al tocar la notificación.
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
