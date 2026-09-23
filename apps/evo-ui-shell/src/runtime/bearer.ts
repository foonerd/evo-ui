// bearer - the stored operator bearer and its scope set.
//
// Tokens are base64url-unpadded JSON: { id, capabilities:
// [ { kind: "read"|"write"|"step_up", scope } ], issued_at_ms,
// expires_at_ms, signature_b64 }. The signature is verified
// framework-side; decoding here is for UI enablement only (which
// affordances CAN work on this session) - never for authority.

export interface BearerCapability {
  kind: string;
  scope: string;
}

/** RFC 6455 subprotocol token guard - minted tokens always pass;
 *  this protects against a hand-pasted foreign value making the
 *  WebSocket constructor throw. */
function subprotocolSafe(token: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(token);
}

export function storedBearer(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const token = window.localStorage.getItem("evoBearer");
  if (token === null || token.length === 0) return undefined;
  if (!subprotocolSafe(token)) return undefined;
  return token;
}

// ---- the one bearer bus ---------------------------------------------
//
// The stored bearer changes in exactly three ways the page can see: a
// pair stores one, the stale-bearer policy purges one, the kiosk remints
// one (written from outside the page, so no event - every handshake
// reads storedBearer() for that case; see bearer-handshake.ts). The two
// in-page writes announce themselves here so every live bearer socket
// re-handshakes at once and a second reload is never needed.

const bearerListeners = new Set<() => void>();

/** Subscribe to in-page bearer writes (store / purge). Returns the
 *  unsubscribe. */
export function onBearerChange(listener: () => void): () => void {
  bearerListeners.add(listener);
  return (): void => {
    bearerListeners.delete(listener);
  };
}

/** Announce an in-page bearer write to every live bearer socket. */
export function notifyBearerChange(): void {
  for (const l of bearerListeners) l();
}

/** Purge the stored operator bearer. Called ONLY once an anonymous
 *  read has proved the device is reachable while the bearer socket was
 *  refused - i.e. the token itself is dead (device reset, revoked, or
 *  expired), never on a transient outage (which fails anonymously too).
 *  The surface then drops to its unpaired "pair to manage" state with
 *  live read-only content, no site-data clearing or incognito needed.
 *  Announces the purge so every other bearer socket goes anonymous on
 *  its next handshake, this page load. */
export function clearBearer(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("evoBearer");
  notifyBearerChange();
}

export function bearerCapabilities(token: string | undefined): BearerCapability[] {
  if (token === undefined) return [];
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64)) as Record<string, unknown>;
    const caps = json["capabilities"];
    if (!Array.isArray(caps)) return [];
    const out: BearerCapability[] = [];
    for (const cap of caps) {
      if (typeof cap === "object" && cap !== null) {
        const rec = cap as Record<string, unknown>;
        if (typeof rec["kind"] === "string" && typeof rec["scope"] === "string") {
          out.push({ kind: rec["kind"], scope: rec["scope"] });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** expires_at_ms off the decoded token, or null when the token is
 *  absent/undecodable. UI display only - expiry is enforced
 *  framework-side. */
export function bearerExpiresAtMs(token: string | undefined): number | null {
  if (token === undefined) return null;
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64)) as Record<string, unknown>;
    const exp = json["expires_at_ms"];
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

export function bearerHasScope(
  token: string | undefined,
  kind: string,
  scope: string
): boolean {
  return bearerCapabilities(token).some((c) => c.kind === kind && c.scope === scope);
}
