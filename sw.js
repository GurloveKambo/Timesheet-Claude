/* =====================================================
   SERVICE WORKER (sw.js)
   
   A service worker is a background script that the browser
   runs separately from the main page. It intercepts network
   requests and can serve cached files when offline.
   
   HOW UPDATES WORK:
   - Every time the user opens the app, the browser checks
     if sw.js has changed.
   - If it has, the new service worker installs quietly in
     the background.
   - The app.js detects this and shows the "Update Available" banner.
   - When the user taps "Update Now", the new version takes over.
   
   TO FORCE AN UPDATE: Change the CACHE_VERSION number below.
   ===================================================== */

// ⬇️ CHANGE THIS NUMBER when you deploy an update (e.g. v2, v3, ...)
const CACHE_VERSION = 'v1.1';
const CACHE_NAME    = 'timesheet-pwa-' + CACHE_VERSION;

// These are all the files we want to cache for offline use.
// If you add new files to the project, add them here too.
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // jsPDF from CDN — cache it so PDF generation works offline
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

/* ----- INSTALL EVENT -----
   Runs once when the service worker first installs.
   We download and store all the app files in the cache.
*/
self.addEventListener('install', event => {
  console.log(`[SW ${CACHE_VERSION}] Installing...`);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log(`[SW ${CACHE_VERSION}] Caching app files`);
        // Cache each file; if one fails, we still continue
        return Promise.allSettled(
          FILES_TO_CACHE.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] Could not cache ${url}:`, err)
            )
          )
        );
      })
      .then(() => {
        console.log(`[SW ${CACHE_VERSION}] Installation complete`);
        // Don't automatically activate yet — wait for user confirmation
        // (this is handled by the skipWaiting message below)
      })
  );
});

/* ----- ACTIVATE EVENT -----
   Runs when this service worker takes control.
   We delete any old caches from previous versions.
*/
self.addEventListener('activate', event => {
  console.log(`[SW ${CACHE_VERSION}] Activating...`);

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('timesheet-pwa-') && name !== CACHE_NAME)
            .map(oldCache => {
              console.log(`[SW] Deleting old cache: ${oldCache}`);
              return caches.delete(oldCache);
            })
        );
      })
      .then(() => {
        // Take control of all open pages immediately
        return self.clients.claim();
      })
  );
});

/* ----- FETCH EVENT -----
   Intercepts every network request.
   Strategy: "Cache First, falling back to Network"
   
   1. Check if we have the file in cache → serve it instantly (fast!)
   2. If not in cache, fetch from network → serve it AND save to cache
   3. If network fails too → show a simple offline message
*/
self.addEventListener('fetch', event => {
  // Only handle GET requests (not POST, etc.)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // We have it cached — return immediately
          return cachedResponse;
        }

        // Not cached — try to fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Cache a copy of the response for next time
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Network failed AND not in cache — user is offline
            // For HTML page requests, show an offline message
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <title>Offline</title>
                  <style>
                    body { font-family: sans-serif; text-align: center; padding: 60px 20px; background: #f0f2f5; }
                    h1 { color: #1a3a5c; }
                    p { color: #666; }
                    button { 
                      background: #1a3a5c; color: white; border: none; 
                      padding: 14px 28px; border-radius: 8px; font-size: 16px; cursor: pointer; 
                    }
                  </style>
                </head>
                <body>
                  <h1>📵 You're Offline</h1>
                  <p>The app needs the internet for its first load.</p>
                  <p>Once loaded once, it works offline.</p>
                  <button onclick="window.location.reload()">Try Again</button>
                </body>
                </html>
              `, { headers: { 'Content-Type': 'text/html' } });
            }
          });
      })
  );
});

/* ----- MESSAGE HANDLER -----
   Receives messages from the main app (app.js).
   When app.js calls postMessage({ action: 'skipWaiting' }),
   this tells the new service worker to activate immediately.
*/
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    console.log('[SW] Activating new version now...');
    self.skipWaiting();
  }
});
