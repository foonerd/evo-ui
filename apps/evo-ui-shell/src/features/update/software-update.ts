// software-update - the audio update source: which registry the device
// pulls plugin updates from, read from the steward's registry list and,
// when there is none, registered as evo-audio-prod.
//
// A registry whose slug begins evo-audio- is already the operator's
// channel and is left alone. The registration names the slug, the manifest
// and the detached signature for this device's target triple, and the
// fingerprint the signing key must present. The triple follows the host
// architecture get_system_info reports (uname): aarch64, x86_64 and armv7l
// have one; anything else has none and nothing is registered.

export const AUDIO_REGISTRY_PREFIX = "evo-audio-";

export const AUDIO_PROD_SLUG = "evo-audio-prod";

export const AUDIO_PROD_FINGERPRINT =
  "sha256:9cd7d7381ee7c2b3bfa490b39077afdc925192299dda661ef94dddba71e574da";

const AUDIO_PROD_BASE =
  "https://raw.githubusercontent.com/foonerd/evo-device-audio-artefacts/main/registries/evo-audio-prod/";

/** The target triple for a host architecture, or null when the device
 *  has no audio update source for it. */
export function targetTriple(architecture: string | null): string | null {
  switch (architecture) {
    case "aarch64":
      return "aarch64-unknown-linux-gnu";
    case "x86_64":
      return "x86_64-unknown-linux-gnu";
    case "armv7l":
      return "armv7-unknown-linux-gnueabihf";
    default:
      return null;
  }
}

export type RegistryRegistration = {
  slug: string;
  manifest_url: string;
  signature_url: string;
  public_key_fingerprint: string;
};

/** The register_plugin_registry payload for evo-audio-prod on a triple. */
export function audioProdRegistration(triple: string): RegistryRegistration {
  return {
    slug: AUDIO_PROD_SLUG,
    manifest_url: `${AUDIO_PROD_BASE}${triple}/registry.toml`,
    signature_url: `${AUDIO_PROD_BASE}${triple}/registry.sig`,
    public_key_fingerprint: AUDIO_PROD_FINGERPRINT
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The slugs list_plugin_registries answers, in its order, or null when
 *  the answer is not a list - a failed list is not an empty one. */
export function decodeRegistrySlugs(raw: unknown): string[] | null {
  if (!isObject(raw)) return null;
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return null;
  const slugs: string[] = [];
  for (const e of entries) {
    if (isObject(e) && typeof e["slug"] === "string" && e["slug"].length > 0) {
      slugs.push(e["slug"]);
    }
  }
  return slugs;
}

/** The audio registries among the slugs - the operator's channel. */
export function audioRegistrySlugs(slugs: ReadonlyArray<string>): string[] {
  return slugs.filter((s) => s.startsWith(AUDIO_REGISTRY_PREFIX));
}

/** The slug a register answer names, or null when it registered none. */
export function decodeRegistered(raw: unknown): string | null {
  if (!isObject(raw) || raw["plugin_registry_registered"] !== true) return null;
  const slug = raw["slug"];
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

/** The refresh_plugin_registry payload: the registered slug alone. */
export function refreshRegistryPayload(slug: string): { slug: string } {
  return { slug };
}

/** The slug a refresh answer echoes, or null when it refreshed none. */
export function decodeRefreshed(raw: unknown): string | null {
  if (!isObject(raw) || raw["plugin_registry_refreshed"] !== true) return null;
  const slug = raw["slug"];
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}
