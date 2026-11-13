self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalado con éxito');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activado');
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Motor básico de respuesta
  event.respondWith(fetch(event.request).catch(() => new Response('Offline')));
});