// Pure decoders for the credential_list_keys wire-op response.
//
// Wire shape (framework credential wire-op contract, 2026-07-23):
//   { credential_listing: true, plugin_id,
//     entries: [ { key_hash, display_name, expires_at_ms,
//                  uninstall_policy, created_at_ms, updated_at_ms } ] }
//
// There is deliberately NO value on the wire - the vault is write-only
// from the UI's side (no credential_get op). The raw key is also never
// emitted: the vault persists only the SHA-256 key_hash (one-way), so
// key_hash is the stable id the UI has for an entry. credential_delete
// accepts key_hash directly, so EVERY listed entry - including leftover
// test markers under keys the UI does not hardcode - is deletable by
// passing its key_hash back verbatim.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOrNull(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

export type UninstallPolicy =
  | "purge"
  | "preserve_for_reinstall"
  | "prompt_operator"
  | "other";

function decodeUninstallPolicy(v: unknown): UninstallPolicy {
  switch (v) {
    case "purge":
    case "preserve_for_reinstall":
    case "prompt_operator":
      return v;
    default:
      return "other";
  }
}

export interface CredentialEntry {
  /** Opaque SHA-256 of the key name - the stable id, and the value
   *  credential_delete accepts to remove this entry. */
  keyHash: string;
  /** Operator-facing label ("Last.fm API key"); null when the writer
   *  omitted it. */
  displayName: string | null;
  /** Wall-clock ms expiry, or null for no natural expiry. */
  expiresAtMs: number | null;
  uninstallPolicy: UninstallPolicy;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

export interface CredentialListing {
  pluginId: string;
  /** Entries as returned (server orders by key_hash ascending). Bad
   *  rows are dropped, never crash the listing. */
  entries: CredentialEntry[];
}

function decodeEntry(raw: unknown): CredentialEntry | null {
  if (!isObject(raw)) return null;
  const keyHash = stringOrNull(raw, "key_hash");
  if (keyHash === null) return null;
  return {
    keyHash,
    displayName: stringOrNull(raw, "display_name"),
    expiresAtMs: intOrNull(raw, "expires_at_ms"),
    uninstallPolicy: decodeUninstallPolicy(raw["uninstall_policy"]),
    createdAtMs: intOrNull(raw, "created_at_ms"),
    updatedAtMs: intOrNull(raw, "updated_at_ms")
  };
}

/** Decode a credential_list_keys success value. Returns null only on a
 *  shape failure (not an object / no plugin_id). An absent or non-array
 *  `entries` decodes to an empty listing (a plugin with no credentials
 *  is the fresh-install case, not an error). */
export function decodeCredentialListing(raw: unknown): CredentialListing | null {
  if (!isObject(raw)) return null;
  const pluginId = stringOrNull(raw, "plugin_id");
  if (pluginId === null) return null;
  const rawEntries = raw["entries"];
  const entries: CredentialEntry[] = [];
  if (Array.isArray(rawEntries)) {
    for (const e of rawEntries) {
      const decoded = decodeEntry(e);
      if (decoded !== null) entries.push(decoded);
    }
  }
  return { pluginId, entries };
}
