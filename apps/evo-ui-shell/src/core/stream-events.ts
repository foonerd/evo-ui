import type { UiEventFrame } from "./types";

export const KNOWN_STREAM_EVENTS = new Set([
  "playback.state",
  "queue.changed",
  "browse.changed",
  "network.changed",
  "ui.settings.changed",
  "system.notice",
  "sync.lagged",
  "error"
]);

export function isKnownStreamEvent(frame: UiEventFrame | null): frame is UiEventFrame {
  return Boolean(frame?.event && KNOWN_STREAM_EVENTS.has(frame.event));
}
