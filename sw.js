/* =====================================================
   FIELDSHEET PWA — SERVICE WORKER (sw.js)

   What this file does:
   1. Caches all app files the first time the app loads
   2. Serves those cached files when offline
   3. Checks for updates every time the app opens
   4. Tells the app when a new version is ready

   HOW TO PUSH AN UPDATE TO USERS:
   Change the number in CACHE_VERSION below (e.g. v2 → v3),
   then re-upload this file to GitHub.
   Next time users open the app, they'll see the update banner.
   ===================================================== */

// ⬇️ CHANGE THIS every time you deploy an update
const CACHE_VERSION = 'v2.3';
const CACHE_NAME    = 'fieldsheet-' + CACHE_VERSION;

// Every file the app needs to work offline.
// If you add new files to the project, add them here too.
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Third-party libraries — cache these so the app works offline
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  // Google Fonts — cache so text looks correct offline
  'https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Figtree:wght@400;500;600;700&display=swap'
];

/* ─────────────────────────────────────────
   INSTALL
   Runs once when the service worker is first installed,
   or when a new version is detected.
   We pre-download and store all app files.
───────────────────────────────────────── */
self.addEventListener('install', event => {
  console.log(`[SW ${CACHE_VERSION}] Installing…`);

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log(`[SW ${CACHE_VERSION}] Caching app files`);

      // Cache each file individually so one failure doesn't break the rest
      return Promise.allSettled(
        FILES_TO_CACHE.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Could not cache ${url}:`, err)
          )
        )
      );
    })
  );
  // NOTE: We do NOT call self.skipWaiting() here.
  // The new version waits patiently until the user taps "Update Now".
  // This prevents the app from reloading mid-fill and losing data.
});

/* ─────────────────────────────────────────
   ACTIVATE
   Runs when this service worker takes over from the old one.
   We delete any old caches to free up storage space.
───────────────────────────────────────── */
self.addEventListener('activate', event => {
  console.log(`[SW ${CACHE_VERSION}] Activating…`);

  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          // Find caches that belong to this app but are old versions
          .filter(name => name.startsWith('fieldsheet-') && name !== CACHE_NAME)
          .map(oldCache => {
            console.log(`[SW] Deleting old cache: ${oldCache}`);
            return caches.delete(oldCache);
          })
      )
    ).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    })
  );
});

/* ─────────────────────────────────────────
   FETCH
   Intercepts every network request the app makes.

   Strategy: Cache-first with network fallback.
   1. Check the cache → if found, return it instantly (works offline)
   2. If not in cache → fetch from network → cache a copy → return it
   3. If network fails and not cached → show offline page (HTML only)

   This means:
   - First load: network (files get cached)
   - All future loads: instant from cache
   - Offline: works from cache
───────────────────────────────────────── */
self.addEventListener('fetch', event => {
  // Only handle GET requests (not form POSTs, etc.)
  if (event.request.method !== 'GET') return;

  // Don't intercept requests to EmailJS API — those must go to the network
  const url = new URL(event.request.url);
  if (url.hostname === 'api.emailjs.com') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {

      if (cachedResponse) {
        // ✅ Found in cache — return immediately (fast, works offline)
        return cachedResponse;
      }

      // Not in cache — go to the network
      return fetch(event.request)
        .then(networkResponse => {
          // Only cache successful responses (status 200)
          // Don't cache error pages or redirects
          if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
            // Clone the response — we need to both cache it AND return it
            // (a response can only be read once, so we make a copy)
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // ❌ Network failed AND not in cache = user is offline with no cached version

          // For HTML page requests, show a friendly offline page
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return new Response(OFFLINE_PAGE, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
          }

          // For other requests (images, etc.), just fail silently
          return new Response('', { status: 408, statusText: 'Offline' });
        });
    })
  );
});

/* ─────────────────────────────────────────
   MESSAGE HANDLER
   app.js sends a message here when the user taps "Update Now".
   We call skipWaiting() to activate the new service worker immediately.
───────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') {
    console.log('[SW] User approved update — activating new version');
    self.skipWaiting();
  }
});

/* ─────────────────────────────────────────
   OFFLINE PAGE HTML
   Shown when the user is completely offline and the
   page hasn't been cached yet (e.g. very first visit with no internet).
───────────────────────────────────────── */
const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FieldSheet — Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: sans-serif;
      background: #0f1f35;
      color: white;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      text-align: center;
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p  { font-size: 15px; color: #8aadcc; line-height: 1.6; max-width: 320px; margin-bottom: 8px; }
    button {
      margin-top: 24px;
      background: #f59e0b;
      color: #0f1f35;
      border: none;
      border-radius: 10px;
      padding: 14px 28px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .note {
      margin-top: 20px;
      font-size: 12px;
      color: #4a5a6e;
    }
  </style>
</head>
<body>
  <div class="icon">📵</div>
  <h1>You're Offline</h1>
  <p>FieldSheet needs an internet connection on its very first load.</p>
  <p>Once it's loaded once, it works completely offline.</p>
  <button onclick="window.location.reload()">Try Again</button>
  <p class="note">Make sure you're connected to Wi-Fi or mobile data, then tap Try Again.</p>
</body>
</html>`;
