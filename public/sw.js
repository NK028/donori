// Minimal service worker so the site can be installed to a phone home screen (PWA).
// Caches only the static shell; API calls and payments always go to the network.
const SHELL = ['/', '/styles.css', '/app.js', '/i18n.js', '/icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open('donori-v1').then(c => c.addAll(SHELL))));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
