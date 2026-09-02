// evo shell service worker.
//
// Caching strategies:
//
//   - Navigation / app shell (`/`, manifest): NETWORK-FIRST. The
//     document that names the current hashed bundle MUST come from
//     the network when online, or the browser boots a stale bundle
//     forever (stale-while-revalidate on the shell serves the
//     PREVIOUS deploy on every load and only refreshes for next
//     time - the bug this fixes). Falls back to cache only offline
//     so the operator still sees the last-rendered surface.
//   - Hashed build assets (`/assets/`, icons): stale-while-
//     revalidate is safe because a new build produces new
//     filenames - a changed asset is a new URL, never a stale hit.
//   - `describe_*` API cache: cached on success, served on offline
//     so the shell renders the last snapshot rather than blank.
//
// Mutation wire ops (POST / PUT / DELETE) are NEVER cached; when
// offline they fail the dispatch and the UI surfaces a
// "no connectivity" diagnostic per the runtime's error path.

const VERSION = "evo-shell-v2";
const APP_CACHE = `${VERSION}-app`;
const API_CACHE = `${VERSION}-api`;

const APP_PRECACHE = ["/", "/manifest.webmanifest", "/icon-192.svg", "/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(APP_PRECACHE);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== APP_CACHE && n !== API_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/v1/describe_")) {
    event.respondWith(staleWhileRevalidate(req, API_CACHE));
    return;
  }
  // The app shell (the document that names the current bundle) is
  // network-first so a deploy is picked up on the next load online.
  if (
    req.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(networkFirst(req, APP_CACHE));
    return;
  }
  // Content-hashed build assets: a new build = new filenames, so the
  // cache can never serve a stale one; keep them fast.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  } catch {
    const cached = await cache.match(req);
    return cached ?? Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((resp) => {
      // Only cache 2xx responses; refusals and offline-during-
      // revalidate leave the cached copy in place.
      if (resp.ok) {
        // Cloning the response keeps the body usable by both
        // the cache write and the returned promise.
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    })
    .catch(() => undefined);

  return cached ?? (await network) ?? Response.error();
}
