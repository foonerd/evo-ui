import type { UiEventFrame } from "./types";

export type ReconcileDomain = "playback" | "queue" | "browse" | "system";

const DOMAIN_EVENTS: Record<ReconcileDomain, Set<string>> = {
  playback: new Set(["playback.state", "sync.lagged"]),
  queue: new Set(["queue.changed", "sync.lagged"]),
  browse: new Set(["browse.changed", "sync.lagged"]),
  system: new Set(["network.changed", "sync.lagged"])
};

export function shouldReconcileFromEvent(
  domain: ReconcileDomain,
  frame: UiEventFrame | null
): boolean {
  if (!frame?.event) {
    return false;
  }
  return DOMAIN_EVENTS[domain].has(frame.event);
}
