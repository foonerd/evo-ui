// Live share state — what Sources paints while a mount runs, and
// which snapshot wins when get_state and a happening disagree.
//
// Share state does not live on the configured list. The first
// get_state can still say "mounting" after the device is already
// Connected. A later happening or event with an older timestamp
// must not put Connecting back on the card.

import type {
  ShareEventItem,
  ShareState,
  ShareStateInfo
} from "./share-decoders.ts";

export const SHARE_STATE_POLL_MS = 1500;

export function preferFresherShareState(
  prev: ReadonlyMap<string, ShareStateInfo>,
  incoming: ShareStateInfo
): Map<string, ShareStateInfo> {
  const existing = prev.get(incoming.shareId);
  if (
    existing !== undefined &&
    existing.lastTransitionAtMs !== null &&
    incoming.lastTransitionAtMs !== null &&
    incoming.lastTransitionAtMs < existing.lastTransitionAtMs
  ) {
    return new Map(prev);
  }
  return new Map(prev).set(incoming.shareId, incoming);
}

export function shareStateFromEvent(ev: ShareEventItem): ShareStateInfo {
  const state: ShareState =
    ev.kind === "mounted"
      ? "mounted"
      : ev.kind === "unmounted"
        ? "unmounted"
        : ev.kind === "mount_failed"
          ? "failed"
          : "mounted";
  return {
    shareId: ev.shareId,
    state,
    reason: ev.detail,
    negotiated: ev.negotiatedVersion,
    lastTransitionAtMs: ev.atMs
  };
}

export function foldEventsIntoStates(
  prev: ReadonlyMap<string, ShareStateInfo>,
  events: readonly ShareEventItem[]
): Map<string, ShareStateInfo> {
  const latest = new Map<string, ShareEventItem>();
  for (const ev of events) {
    const held = latest.get(ev.shareId);
    if (held === undefined || ev.atMs >= held.atMs) {
      latest.set(ev.shareId, ev);
    }
  }
  let next = new Map(prev);
  for (const ev of latest.values()) {
    next = preferFresherShareState(next, shareStateFromEvent(ev));
  }
  return next;
}

export type SourcesHeartbeat =
  | { kind: "mounting"; alias: string }
  | { kind: "working" }
  | null;

export function sourcesHeartbeat(
  busy: boolean,
  items: readonly { alias: string; state: ShareState }[] | null
): SourcesHeartbeat {
  const mounting = items?.find((s) => s.state === "mounting");
  if (mounting !== undefined) {
    return { kind: "mounting", alias: mounting.alias };
  }
  if (busy) return { kind: "working" };
  return null;
}
