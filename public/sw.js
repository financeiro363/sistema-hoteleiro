// ============================================================================
// Service worker do Sistema Hoteleiro — só para os AVISOS NO CELULAR
// (pedidos da recepção para a camareira). Não guarda páginas em cache.
// ============================================================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()));

self.addEventListener('push', (evento) => {
  let dados = {};
  try { dados = evento.data ? evento.data.json() : {}; } catch (e) { dados = { corpo: evento.data ? evento.data.text() : '' }; }
  const titulo = dados.titulo || 'Sistema Hoteleiro';
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: dados.corpo || '',
    tag: dados.tag || undefined,
    renotify: !!dados.tag,
    icon: '/icons/icone-192.png',
    badge: '/icons/selo-96.png',
    vibrate: [200, 100, 200, 100, 200],
    data: { url: dados.url || '/governanca' },
  }));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL((evento.notification.data && evento.notification.data.url) || '/governanca', self.location.origin).href;
  evento.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
    for (const janela of janelas) {
      if (janela.url.startsWith(self.location.origin)) {
        return janela.focus().then((j) => (j && 'navigate' in j ? j.navigate(destino) : j));
      }
    }
    return self.clients.openWindow(destino);
  }));
});
