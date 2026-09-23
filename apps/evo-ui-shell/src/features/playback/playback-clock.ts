// playback-clock - the one clock the hero bar and the stage bar share.
// Pure: no hooks, no DOM, no wall-clock reads of its own.
//
// The warden publishes now_playing on transitions only - play, pause,
// stop, track change, seek - never on the playhead simply advancing.
// The glass keeps the bar moving by anchoring on the last sample and
// advancing a local clock while playing (interpolateElapsedMs). The
// anchor's time must be the moment the sample was OBSERVED, stamped
// once where the sample arrives, and every surface must read that
// same stamp: two surfaces capturing their own Date.now() are two
// clocks, and fixing one leaves the other lying.
//
// The first "playing" sample of a track is taken when the verb is,
// with the elapsed the warden had then - usually 0 - while the audible
// start lands later (decoder, output buffer, a NAS read). A clock that
// free-runs from that sample sits ahead of the music until the next
// transition. So a fresh start schedules exactly one get_now_playing
// read after START_REANCHOR_MS, and the sample it brings back
// re-anchors both clocks on what the warden reports then. One read,
// once, on a start. Not a cadence.

import type { ElapsedAnchor, NowPlaying } from "./now-playing-decoders";

/** A playing sample this near the head of a track is a start. */
export const START_WINDOW_MS = 2_000;

/** The one grace before the single re-anchor read: long enough for a
 *  normal audible start to have happened, short enough that the bar
 *  is right within the first bars of the track. */
export const START_REANCHOR_MS = 1_800;

/** The anchor both surfaces interpolate from: the sample's reported
 *  position and the wall-clock time the sample was observed. Null when
 *  there is no sample, no position, or no observation time. */
export function elapsedAnchorOf(
  nowPlaying: NowPlaying | null,
  observedAtMs: number | null
): ElapsedAnchor | null {
  if (nowPlaying === null || observedAtMs === null) return null;
  if (nowPlaying.elapsedMs === null) return null;
  return { elapsedMs: nowPlaying.elapsedMs, atMs: observedAtMs };
}

function trackKey(nowPlaying: NowPlaying): string {
  return nowPlaying.track?.mpdPath ?? "";
}

/** Whether `next` is the first playing sample of a track: playing,
 *  near the head, and the previous sample was not already playing
 *  that same track. A seek or a late transition on a track already
 *  playing is not a start. */
export function isFreshStart(prev: NowPlaying | null, next: NowPlaying): boolean {
  if (next.transportState !== "playing") return false;
  if (next.elapsedMs === null || next.elapsedMs > START_WINDOW_MS) return false;
  if (prev === null || prev.transportState !== "playing") return true;
  return trackKey(prev) !== trackKey(next);
}

/** The one-shot re-anchor delay a start earns; null for every other
 *  sample. */
export function startReanchorDelayMs(
  prev: NowPlaying | null,
  next: NowPlaying
): number | null {
  return isFreshStart(prev, next) ? START_REANCHOR_MS : null;
}
