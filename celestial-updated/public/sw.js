// The shell is cached so the app opens instantly and survives a dead network;
// moves, presence and the archive always come from the server.
const SHELL = 'celestial-shell-v1';
const FILES = ['/', '/index.html', '/css/app.css', '/js/three.min.js', '/js/celestial-world.js',
  '/js/chess-3d.js', '/js/engine-bridge.js', '/js/intro.js', '/js/app.js', '/engine.js',
  '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== SHELL).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // moves & logins never cached
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;           // the game state is never stale
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('/index.html')))
  );
});
