// Service worker: sovellus toimii myös ilman verkkoyhteyttä.
// Nosta VERSION aina julkaisun yhteydessä, niin käyttäjät saavat päivityksen.
const VERSION = 'v1.1.0';
const CACHE = `levyhylly-${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'kentat.json',
  'js/boot.js', 'js/app.js', 'js/config.js', 'js/csv.js', 'js/db.js', 'js/image.js', 'js/cropper.js',
  'js/merge.js', 'js/model.js', 'js/schema.js', 'js/query.js', 'js/table.js', 'js/filters.js',
  'js/fieldeditor.js', 'js/sync.js', 'js/themes.js', 'js/ui.js', 'js/zip.js',
  'js/backends/index.js', 'js/backends/folder.js', 'js/backends/dropbox.js', 'js/backends/gdrive.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Vain oman sivuston tiedostot välimuistista; pilvipalveluiden kutsut menevät aina verkkoon.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Kenttämäärittely: aina ensin verkosta, jotta muokkaus näkyy heti ilman uutta versiota
  if (url.pathname.endsWith('/kentat.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(e.request, { cache: 'no-cache' });
        if (res.ok) cache.put('kentat.json', res.clone());
        return res;
      } catch {
        return (await cache.match('kentat.json')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    const network = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached || (e.request.mode === 'navigate' ? cache.match('index.html') : Response.error()));
    return cached || network;
  })());
});
