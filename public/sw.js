// Service worker mínimo: só habilita "Instalar como aplicativo". NÃO guarda nada em cache
// (o app se atualiza sozinho pelo /version.json; cache aqui atrapalharia isso).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
