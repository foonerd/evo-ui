// Step B: react to a resolve landing so a glyph swaps to the image in
// place - no navigation, no Refresh.
//
// The distribution artwork hookup emits an artwork_resolved PluginEvent on
// the bus when the cascade writes a hash: event_type "artwork_resolved",
// payload { scheme, value, size, content_hash }. It is
// NOT a framework Happening variant - the resolve route is distribution
// product. It fires only on a landing, never on a warm paint, so a browse
// over already-resolved art is silent. One shared subscription
// (useArtworkResolvedSubscription, mounted once by the browse surface)
// pumps those events into this store; each tile subscribes to its own
// (scheme, value) key and reloads when it bumps.
//
// Keying is (scheme, value) only, deliberately not size: resolving one size
// nails the identity, and a tile requesting a different size should still
// re-attempt (it now resolves, or transiently retries per Step A) rather
// than stay a glyph because the landed size differed from the painted one.

import { useCallback, useEffect, useState } from "preact/hooks";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { attachSharedHappenings } from "../../runtime/shared-framework-attach";

const SEP = "::";
const ticks = new Map<string, number>();
const listeners = new Set<() => void>();

function keyOf(scheme: string, value: string): string {
  return scheme + SEP + value;
}

/** Extract the (scheme, value) key a tile paints, from its cover_url query.
 *  Returns null when the URL carries no scheme/value (e.g. a hash URL). */
export function artworkKeyFromUrl(url: string | null): string | null {
  if (url === null) return null;
  const q = url.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  const scheme = params.get("scheme");
  const value = params.get("value");
  if (scheme === null || value === null) return null;
  return keyOf(scheme, value);
}

/** Feed one bus happening into the store. Ignores anything that is not an
 *  artwork_resolved landing.
 *
 *  Carrier: a domain-neutral PluginEvent, not a framework Happening
 *  variant. `event_type` sits at the top of the happening
 *  (next to `type`) and discriminates; the resolved subject is in
 *  `payload` as { scheme, value, size, content_hash }. Do not gate on
 *  `plugin`. */
export function ingestArtworkResolved(happening: unknown): void {
  if (typeof happening !== "object" || happening === null) return;
  const h = happening as Record<string, unknown>;
  if (h["type"] !== "plugin_event") return;
  if (h["event_type"] !== "artwork_resolved") return;
  const payload = h["payload"];
  if (typeof payload !== "object" || payload === null) return;
  const p = payload as Record<string, unknown>;
  const scheme = p["scheme"];
  const value = p["value"];
  if (typeof scheme !== "string" || typeof value !== "string") return;
  const key = keyOf(scheme, value);
  ticks.set(key, (ticks.get(key) ?? 0) + 1);
  for (const l of listeners) l();
}

/** Reactively track the resolve-tick for one tile's key. Re-renders the
 *  caller when a resolve lands for that (scheme, value). */
export function useArtworkResolvedTick(coverUrl: string | null): number {
  const key = artworkKeyFromUrl(coverUrl);
  const read = useCallback(
    (): number => (key === null ? 0 : (ticks.get(key) ?? 0)),
    [key]
  );
  const [tick, setTick] = useState(read);
  useEffect(() => {
    setTick(read());
    if (key === null) return undefined;
    const listener = (): void => setTick(read());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key, read]);
  return tick;
}

/** Own the single artwork_resolved subscription on the shared transport.
 *  Mount once where tiles live (the browse surface). No-op without a
 *  transport (designer / tests). */
export function useArtworkResolvedSubscription(): void {
  const transport = tryUseFrameworkTransport();
  useEffect(() => {
    if (transport === null) return undefined;
    // Default happenings subscribe (denies only the ~30Hz spectrum
    // subject). The artwork_resolved PluginEvent is delivered on any
    // happenings subscription regardless of that subject filter; we match
    // it client-side by event_type in ingest. Reuses the exact path the
    // visualiser proves works, and leaves the shared spectrum-deny
    // subscribe untouched.
    const attach = attachSharedHappenings(transport, {
      onConnecting: () => {},
      onConnected: () => {},
      onError: () => {},
      isCancelled: () => false,
      afterOpen: async () => {},
      onHappening: (raw) => ingestArtworkResolved(raw)
    });
    return () => attach.stop();
  }, [transport]);
}
