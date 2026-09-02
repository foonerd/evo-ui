// Pure decoders for the online_providers_list wire-op response.
//
// Wire shape (framework online_providers CRUD surface):
//   { online_providers_listing: true,
//     entries: [ { provider_id, enabled, priority, updated_at_ms,
//                  privacy_class, has_credential, kinds: [...],
//                  license } ] }
//
// The server orders entries by (priority ascending, provider_id
// ascending) - priority 0 is highest, 999 lowest, 100 the default.
// has_credential is the honest "is the required key present" flag:
// anonymous providers are always true; identity-bearing providers
// reflect an actual vault presence check, so the panel can show a
// "needs key" affordance without lying.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOr(o: Record<string, unknown>, k: string, fallback: number): number {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
}

function boolOr(o: Record<string, unknown>, k: string, fallback: boolean): boolean {
  const v = o[k];
  return typeof v === "boolean" ? v : fallback;
}

export interface ProviderEntry {
  providerId: string;
  enabled: boolean;
  /** 0 = highest priority in the cascade, 999 = lowest, 100 default.
   *  A negative sentinel from the store means "operator has not set an
   *  explicit priority"; decoded to null so the UI shows the default. */
  priority: number | null;
  updatedAtMs: number | null;
  /** "anonymous" | "identity_bearing" | other. */
  privacyClass: string | null;
  /** True when the provider is usable: anonymous providers always,
   *  identity-bearing only when the required key is in the vault. */
  hasCredential: boolean;
  /** Content kinds this provider serves (artist_bio, album_notes, ...). */
  kinds: string[];
  license: string | null;
}

export interface ProviderListing {
  entries: ProviderEntry[];
}

function decodeEntry(raw: unknown): ProviderEntry | null {
  if (!isObject(raw)) return null;
  const providerId = stringOrNull(raw, "provider_id");
  if (providerId === null) return null;
  const rawPriority = intOr(raw, "priority", 100);
  const kindsRaw = raw["kinds"];
  const kinds: string[] = [];
  if (Array.isArray(kindsRaw)) {
    for (const k of kindsRaw) {
      if (typeof k === "string" && k.length > 0) kinds.push(k);
    }
  }
  return {
    providerId,
    enabled: boolOr(raw, "enabled", false),
    priority: rawPriority < 0 ? null : rawPriority,
    updatedAtMs: (() => {
      const v = raw["updated_at_ms"];
      return typeof v === "number" && Number.isFinite(v) && v > 0
        ? Math.round(v)
        : null;
    })(),
    privacyClass: stringOrNull(raw, "privacy_class"),
    hasCredential: boolOr(raw, "has_credential", true),
    kinds,
    license: stringOrNull(raw, "license")
  };
}

/** Decode an online_providers_list success value. Returns null only on
 *  a shape failure (not an object). An absent / non-array `entries`
 *  decodes to an empty listing. */
export function decodeProviderListing(raw: unknown): ProviderListing | null {
  if (!isObject(raw)) return null;
  const rawEntries = raw["entries"];
  const entries: ProviderEntry[] = [];
  if (Array.isArray(rawEntries)) {
    for (const e of rawEntries) {
      const decoded = decodeEntry(e);
      if (decoded !== null) entries.push(decoded);
    }
  }
  return { entries };
}
