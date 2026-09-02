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
