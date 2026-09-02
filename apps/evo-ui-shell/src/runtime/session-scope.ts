// Session scope - the two-scope display model.
//
// NATIVE screens are hardware-attached panels (DSI/HDMI/SPI); the
// designer targets them as its standard job and their layouts live
// under the screen's own profile key. The REMOTE screen is the single
// browser-facing scope: its default is the derived full-reference
// view (every installed widget and page - what the UI can do), it is
// editable independently of every native screen, and it resets
// independently.
//
// Classification is a fact, not configuration:
// - An explicit path wins: /native and /remote state intent in the
//   URL, visible in every log line. /native from a desk is the
//   sanctioned way to inspect the panel's session (the mirror
//   wrapper); /remote on the kiosk shows the reference view on glass.
// - Otherwise the hostname decides: the device's own kiosk is the
//   one client that reaches the UI as loopback; every remote browser
//   arrives by device IP or mDNS name.
//
// No viewport sniffing, no thresholds - consistent with the space
// model. The runtime serves any unknown path as index.html (SPA
// fallback, server.rs), so the path contract costs the server
// nothing.

export type SessionScope = "native" | "remote";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when the host is the device's own loopback - the kiosk. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) {
    return true;
  }
  // Full 127.0.0.0/8 answers loopback, not just .0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** Explicit scope claimed by the path, if any. First segment only:
 *  /native and /remote are entry points, not a routing namespace. */
export function scopeFromPath(pathname: string): SessionScope | null {
  const first = pathname.split("/").filter((s) => s.length > 0)[0];
  if (first === "native") {
    return "native";
  }
  if (first === "remote") {
    return "remote";
  }
  return null;
}

/** Resolve the session scope: explicit path wins, hostname decides
 *  otherwise. Deterministic and pure - both inputs come from
 *  window.location. */
export function sessionScope(pathname: string, hostname: string): SessionScope {
  const claimed = scopeFromPath(pathname);
  if (claimed !== null) {
    return claimed;
  }
  return isLoopbackHost(hostname) ? "native" : "remote";
}

/** Convenience read from the live window; null-safe for tests/SSR. */
export function readSessionScope(): SessionScope {
  if (typeof window === "undefined") {
    return "remote";
  }
  return sessionScope(window.location.pathname, window.location.hostname);
}
