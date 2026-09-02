// Hash-based router. The framework's admitted shelf set IS the
// route table: every admitted shelf is reachable via
// `#/shelf/<shelf_id>`, no hardcoded page list, no static config.
// New shelves the framework admits surface as new routes without
// any shell-side code change.
//
// Hash-based routing keeps the shell deployable from any static
// origin (the framework's HTTPS substrate serves an
// `index.html` + assets; the hash never touches the server).

import { signal, type Signal } from "@preact/signals";

/** Discriminated route. */
export type Route =
  | { readonly kind: "root" }
  | { readonly kind: "shelf"; readonly shelfId: string }
  | { readonly kind: "unknown"; readonly raw: string };

/**
 * Parse a hash fragment into a `Route`. Empty / absent hash maps
 * to `root`; `#/shelf/<id>` maps to a shelf route; everything else
 * maps to `unknown` so the renderer can surface the fallback.
 */
export function parseHash(hash: string): Route {
  if (hash === "" || hash === "#" || hash === "#/") {
    return { kind: "root" };
  }
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  if (stripped.startsWith("/shelf/")) {
    const id = decodeURIComponent(stripped.slice("/shelf/".length));
    if (id.length > 0) return { kind: "shelf", shelfId: id };
  }
  return { kind: "unknown", raw: stripped };
}

/** Build a hash for the named shelf route. */
export function shelfHash(shelfId: string): string {
  return `#/shelf/${encodeURIComponent(shelfId)}`;
}

/**
 * Construct a reactive route signal bound to `window.location.hash`.
 * Components binding through `useComputed` re-render on every
 * navigation. Calling `navigate` updates `location.hash`; the
 * `hashchange` listener back-propagates the value into the signal.
 */
export function createRouter(): { route: Signal<Route>; navigate(route: Route): void } {
  if (typeof window === "undefined") {
    return {
      route: signal<Route>({ kind: "root" }),
      navigate(): void {
        // no-op outside the browser
      },
    };
  }
  const route = signal<Route>(parseHash(window.location.hash));
  window.addEventListener("hashchange", () => {
    route.value = parseHash(window.location.hash);
  });
  return {
    route,
    navigate(target: Route): void {
      const hash = routeToHash(target);
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      } else {
        // Force re-emit when navigating to the same route — useful
        // for refresh-style behaviour on operator-driven re-fetch.
        route.value = parseHash(hash);
      }
    },
  };
}

function routeToHash(route: Route): string {
  switch (route.kind) {
    case "root":
      return "#/";
    case "shelf":
      return shelfHash(route.shelfId);
    case "unknown":
      return `#${route.raw.startsWith("/") ? route.raw : `/${route.raw}`}`;
  }
}
