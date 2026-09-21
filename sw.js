/*
 * sw.js – Service Worker: macht Lane Racer offline startbar und beschleunigt Wiederbesuche.
 *
 *  - Eigene Dateien:      "network first" – online bekommst du immer den neuesten Stand,
 *                         ohne Verbindung (oder bei sehr langsamer) kommt der Cache.
 *  - Bibliotheken (CDN):  "cache first" – three.js und Co. sind versioniert und ändern sich nie.
 *  - Supabase (Rangliste, Party): wird nie gecacht, immer live.
 *
 * Bei einem Update die Version unten erhöhen: Der alte Cache wird dann aufgeräumt.
 */
const VERSION = 'lane-racer-2.6.0';
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const NETWORK_TIMEOUT_MS = 4000;

// Alles, was zum Starten nötig ist – wird beim ersten Besuch vorab geladen
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icon.svg',
  'js/main.js',
  'js/config.js',
  'js/rng.js',
  'js/storage.js',
  'js/bend.js',
  'js/structures.js',
  'js/tutorial.js',
  'js/clipboard.js',
  'js/friends.js',
  'js/cloud.js',
  'js/input.js',
  'js/ui-kit.js',
  'js/campaign.js',
  'js/game.js',
  'js/cars.js',
  'js/world.js',
  'js/effects.js',
  'js/audio.js',
  'js/online.js',
  'js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Live-Daten niemals aus dem Cache
  if (url.hostname.endsWith('.supabase.co')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

/** Seitenaufrufe (auch mit ?party=… oder ?c=…) teilen sich einen Cache-Eintrag: index.html. */
function cacheKey(request) {
  return request.mode === 'navigate' ? new Request('index.html') : request;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const key = cacheKey(request);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response && response.ok) cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // "opaque" (Status 0) sind Stylesheets/Schriften ohne CORS – die dürfen trotzdem in den Cache
  if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
  return response;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}
