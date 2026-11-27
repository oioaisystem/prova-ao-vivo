// Service worker mínimo: guarda a "casca" do app para abrir rápido e permitir instalar.
const CACHE = 'oioai-t10-v7';
const CASCA = ['./', './index.html', './app.js?v=7', './manifest.webmanifest', './icone-192.png', './icone-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // bibliotecas e modelo vêm da rede
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
