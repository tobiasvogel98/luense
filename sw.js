// sw.js — Service-Worker: Precache aller App-Dateien, Update via Versionsstempel.
// VERSION bei jeder Aenderung an App-Dateien hochzaehlen — alte Caches werden
// beim Aktivieren geloescht, danach laedt die Seite die neuen Dateien.

const VERSION = 'luense-v5';

const DATEIEN = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './lib/pouchdb.min.js',
  './kern/speicher.js',
  './kern/stamm.js',
  './kern/kamera.js',
  './kern/pdf.js',
  './kern/export.js',
  './kern/ui.js',
  './module/ereignis.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(DATEIEN)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((name) => name !== VERSION).map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Cache-first: alles Precachte kommt aus dem Cache, sonst Netz.
// Navigationen fallen offline auf die index.html zurueck.
self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;
  ereignis.respondWith(
    caches.match(anfrage, { ignoreSearch: true }).then((treffer) =>
      treffer
      || fetch(anfrage).catch(() => {
        if (anfrage.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }),
    ),
  );
});
