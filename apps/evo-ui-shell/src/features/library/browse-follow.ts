// browse-follow - whether a sources republish moves the folder browse.
//
// useLibrary applies every audio_library_sources republish to its
// sources list. The Library surface watches the row of the source it is
// browsing through that list - no second socket ask - and decides:
//
//   hold         the row is byte-identical and no source left the list
//                (an unrelated source changed or joined, or only a
//                display name did), the first observation after mount
//                (the mount browse already ran), or a source switch
//                (the source-change effect browses)
//   refetch      the row changed in a way the listing can follow: state
//                (online / offline serves the cache marked stale),
//                counts (a scan settled, a tree was pruned), mount path
//                - or ANY source left the republish: a yanked stick's
//                tree is pruned under the local library too (Local
//                library > USB > Audio) while the local row itself often
//                does not move
//   source-gone  the browsed row is no longer in the republish (Remove /
//                yank / scrub): the surface falls back to the
//                non-removable local source's root
//
// A refetch re-browses the path the operator is looking at and, when
// that path no longer answers (pruned tree, scrubbed folder), walks
// up crumb by crumb to the first path that does, ending at the source
// root. A timeout / deadline is not a gone path — the walk stops.
// Pure; the contract harness drives every branch.

import type { SourceRecord } from "./library-decoders.ts";

/** The source the plugin refuses to remove - the floor the browse
 *  falls back to when the browsed source is gone. */
export const FALLBACK_SOURCE_ID = "local-internal";

/** USB, NFS, SMB, cloud — a store that is not in the list is
 *  gone. Browse the floor, do not ask the plugin for it. */
export function selectedStoreOrFloor(
  sourceIds: ReadonlyArray<string> | null,
  selectedId: string
): string {
  if (sourceIds === null) return selectedId;
  return sourceIds.includes(selectedId) ? selectedId : FALLBACK_SOURCE_ID;
}

/** Browse of a store the plugin already dropped. The glass used
 *  to toast `refused: 400 Bad Request` and keep the dead id —
 *  that is not Remove, and it is not a listing. Floor. */
export function browseRefusalIsMissingStore(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("unknown_source") ||
    lower.includes("unknown source") ||
    lower.includes("400")
  );
}

/** The fields of a source row whose change can change a listing.
 *  null when the source is not in the list. */
export function sourceRowSignature(row: SourceRecord | null | undefined): string | null {
  if (row === undefined || row === null) return null;
  return [row.kind, row.state, row.mountPath, row.trackCount, row.trackCountAvailable].join("|");
}

export interface BrowsedSource {
  /** The browsed source's id. */
  id: string;
  /** Its row signature, null when it is not in the list. */
  sig: string | null;
  /** Every source id the republish carried. */
  ids: ReadonlyArray<string>;
}

export type BrowseFollow = "hold" | "refetch" | "source-gone";

export function browseFollow(prev: BrowsedSource | undefined, next: BrowsedSource): BrowseFollow {
  if (prev === undefined) return "hold";
  if (prev.id !== next.id) return "hold";
  if (next.sig === null) return prev.sig === null ? "hold" : "source-gone";
  if (next.sig !== prev.sig) return "refetch";
  // A source that left the republish may have taken a tree under this
  // one with it; a source that joined took nothing.
  const left = prev.ids.some((id) => !next.ids.includes(id));
  return left ? "refetch" : "hold";
}

/** The paths a refetch tries, in order: the current path, then each
 *  crumb above it (deepest first), then the root - once each. Crumbs
 *  are the surface's own breadcrumb paths (a "/"-joined path for a
 *  local or NAS source, the opaque object-id trail for DLNA), so
 *  nothing here splits a path. */
export function walkUpPaths(current: string, crumbPaths: ReadonlyArray<string>): string[] {
  const out: string[] = [current];
  const at = crumbPaths.indexOf(current);
  const above = at >= 0 ? crumbPaths.slice(0, at) : crumbPaths.slice();
  for (let i = above.length - 1; i >= 0; i -= 1) {
    if (!out.includes(above[i])) out.push(above[i]);
  }
  if (!out.includes("")) out.push("");
  return out;
}
