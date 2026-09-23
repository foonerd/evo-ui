// share-event-alias - the name on an Activity line, stamped at ingest.
//
// The events ring names a share by share_id. The plugin now copies the
// operator alias onto each event; older rings and older players do not.
// A configured record can supply the name while the share exists, but
// the ring is republished whole on every change and the record is gone
// the moment the share is removed - so the name has to be REMEMBERED
// from whatever taught it (a wire alias, a configured record) and
// stamped onto every event at ingest, never looked up at paint time.
//
// Rules, all pure:
//   - a non-blank wire alias wins, and teaches the memory;
//   - otherwise the remembered name for that share_id;
//   - a blank string is not a name: it never wipes a remembered one;
//   - nothing here ever substitutes an id for a name - an event with no
//     known name carries null and the surface paints neutral copy.

import type { ShareEventItem } from "./share-decoders.ts";

/** share_id -> the last name known for it, from any source. */
export type ShareAliasMemory = Map<string, string>;

export function nonBlank(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Teach the memory every alias the configured list carries. */
export function rememberShareAliases(
  memory: ShareAliasMemory,
  shares: ReadonlyArray<{ shareId: string; alias: string }>
): void {
  for (const share of shares) {
    const name = nonBlank(share.alias);
    if (name !== null) memory.set(share.shareId, name);
  }
}

/** Stamp a name onto each event at ingest. Returns new items; the
 *  input is not mutated. A wire alias teaches the memory as it goes. */
export function stampEventAliases(
  events: ReadonlyArray<ShareEventItem>,
  memory: ShareAliasMemory
): ShareEventItem[] {
  return events.map((ev) => {
    const wire = nonBlank(ev.alias);
    if (wire !== null) {
      memory.set(ev.shareId, wire);
      return ev.alias === wire ? ev : { ...ev, alias: wire };
    }
    const known = memory.get(ev.shareId) ?? null;
    return ev.alias === known ? ev : { ...ev, alias: known };
  });
}
