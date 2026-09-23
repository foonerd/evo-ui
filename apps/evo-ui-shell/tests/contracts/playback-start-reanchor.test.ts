// Contract: on first play the progress bar shows the audible position.
//
// The warden publishes now_playing on transitions only. The first
// "playing" sample of a track arrives when the verb is taken, with the
// elapsed the warden had then - typically 0 - while the audible start
// lands later (decoder, output buffer, a NAS read). The glass anchored
// its clock at that sample and free-ran from it until the next
// transition, so the hero bar and the stage bar sat ahead of the
// music for the whole track, until a pause or a track change.
//
// Now: every sample is stamped with the wall-clock time it was
// observed (usePlayback), the hero and the stage both anchor on that
// one stamp (playback-clock.ts, no local Date.now() capture), and a
// fresh start - a playing sample near the head of a track that the
// previous sample was not already playing - schedules exactly one
// get_now_playing read after START_REANCHOR_MS, whose sample
// re-anchors both clocks on the position the warden reports then. A
// newer sample cancels a pending one. No standing poll.
//
// Goes RED if a start no longer schedules the one-shot, if a
// continuing sample does, if either surface captures its own anchor
// time or keys the anchor on content, if the hook grows a
// setInterval, or if seek stops being the seek verb.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  START_REANCHOR_MS,
  START_WINDOW_MS,
  elapsedAnchorOf,
  isFreshStart,
  startReanchorDelayMs
} from "../../src/features/playback/playback-clock.ts";
import {
  decodeNowPlaying,
  interpolateElapsedMs,
  type NowPlaying
} from "../../src/features/playback/now-playing-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

function sample(
  transport: "playing" | "paused" | "stopped",
  elapsedMs: number | null,
  mpdPath = "a/one.flac"
): NowPlaying {
  const np = decodeNowPlaying({
    transport_state: transport,
    elapsed_ms: elapsedMs,
    duration_ms: 228_000,
    volume: 40,
    track: transport === "stopped" ? null : { mpd_path: mpdPath, title: "one" }
  });
  assert.ok(np !== null);
  return np;
}

test("constants: a start is near the head; the one read lands after the usual audible start", () => {
  assert.ok(START_WINDOW_MS >= 1_000 && START_WINDOW_MS <= 5_000, "start window is seconds, not a poll cadence");
  assert.ok(START_REANCHOR_MS >= 1_000 && START_REANCHOR_MS <= 3_000, "one short grace, then one read");
});

test("isFreshStart: first play, resume from stop, and a track change are starts; continuing is not", () => {
  assert.equal(isFreshStart(null, sample("playing", 0)), true);
  assert.equal(isFreshStart(sample("stopped", null), sample("playing", 0)), true);
  assert.equal(isFreshStart(sample("playing", 214_000, "a/one.flac"), sample("playing", 0, "a/two.flac")), true);
  assert.equal(isFreshStart(sample("paused", 0), sample("playing", 120)), true);
  // The same track, already playing, further in: a seek or a late
  // transition, not a start.
  assert.equal(isFreshStart(sample("playing", 0), sample("playing", 1_500)), false);
  assert.equal(isFreshStart(sample("playing", 30_000), sample("playing", 31_000)), false);
  // Not playing, or too far in to be a start, or no position at all.
  assert.equal(isFreshStart(null, sample("paused", 0)), false);
  assert.equal(isFreshStart(null, sample("playing", START_WINDOW_MS + 1)), false);
  assert.equal(isFreshStart(null, sample("playing", null)), false);
  assert.equal(isFreshStart(sample("playing", 0), sample("stopped", null)), false);
});

test("startReanchorDelayMs: the one-shot delay on a start, null otherwise", () => {
  assert.equal(startReanchorDelayMs(null, sample("playing", 0)), START_REANCHOR_MS);
  assert.equal(startReanchorDelayMs(sample("playing", 0), sample("playing", 1_800)), null);
  assert.equal(startReanchorDelayMs(sample("playing", 0), sample("paused", 900)), null);
});

test("elapsedAnchorOf: the anchor is the sample and the time it was observed - nothing else", () => {
  assert.deepEqual(elapsedAnchorOf(sample("playing", 0), 1_000_000), { elapsedMs: 0, atMs: 1_000_000 });
  assert.deepEqual(elapsedAnchorOf(sample("paused", 4_200), 1_000_500), { elapsedMs: 4_200, atMs: 1_000_500 });
  assert.equal(elapsedAnchorOf(sample("stopped", null), 1_000_000), null);
  assert.equal(elapsedAnchorOf(null, 1_000_000), null);
  assert.equal(elapsedAnchorOf(sample("playing", 0), null), null);
});

test("the bar follows the re-anchored sample, not the first one", () => {
  // First sample at T: playing, 0. Audio actually starts at T + 1200.
  // Free-running from the first sample, the bar at T + 5000 reads 5000.
  const first = elapsedAnchorOf(sample("playing", 0), 100_000);
  assert.ok(first !== null);
  assert.equal(interpolateElapsedMs(first, 105_000, true, 228_000), 5_000);
  // The one-shot read at T + START_REANCHOR_MS reports what is audible
  // then; anchored on that sample, the bar at T + 5000 reads the
  // audible position: (START_REANCHOR_MS - 1200) + (5000 - START_REANCHOR_MS).
  const audibleAtRead = START_REANCHOR_MS - 1_200;
  const second = elapsedAnchorOf(sample("playing", audibleAtRead), 100_000 + START_REANCHOR_MS);
  assert.ok(second !== null);
  assert.equal(interpolateElapsedMs(second, 105_000, true, 228_000), 3_800);
});

test("PIN: the hook stamps every sample, schedules the one-shot on a start, cancels on the next sample, never polls", () => {
  const hook = src("features/playback/usePlayback.ts");
  assert.match(hook, /nowPlayingObservedAtMs/, "the observation time is part of playback state");
  assert.match(hook, /startReanchorDelayMs\(/, "a start is decided by the pure rule");
  assert.match(hook, /window\.setTimeout\(/, "one-shot, not a cadence");
  assert.match(hook, /window\.clearTimeout\(/, "a newer sample cancels the pending read");
  assert.ok(!/setInterval/.test(hook), "no standing position poll in the hook");
  assert.match(hook, /refreshNowPlayingSeed\(transport\)/, "the read is get_now_playing, the same seed read");
  assert.ok(!/dispatchVerb\("play"/.test(hook.replace(/const play = useCallback\(\(\) => dispatchVerb\("play", \{\}\), \[dispatchVerb\]\);/, "")), "no second play command anywhere");
  const session = src("features/playback/playback-session.ts");
  assert.ok(!/setInterval/.test(session), "no standing position poll in the session");
});

test("PIN: hero and stage anchor on the one observed stamp - no local capture, no content key", () => {
  for (const rel of ["features/playback/PlaybackSurface.tsx", "features/playback/StageSurface.tsx"]) {
    const surface = src(rel);
    assert.match(surface, /elapsedAnchorOf\(nowPlaying, nowPlayingObservedAtMs\)/, `${rel} anchors on the observed stamp`);
    assert.ok(!/atMs: Date\.now\(\)/.test(surface), `${rel} captures no anchor time of its own`);
    assert.ok(!/anchorKey/.test(surface), `${rel} keys no anchor on content`);
    assert.match(surface, /interpolateElapsedMs\(/, `${rel} still interpolates between samples`);
    assert.match(surface, /refreshNowPlaying\(\)/, `${rel} keeps the pegged-bar watchdog`);
  }
  // Seek still seeks.
  const hook = src("features/playback/usePlayback.ts");
  assert.match(hook, /dispatchVerb\("seek", \{ position_ms: Math\.round\(positionMs\) \}\)/);
});
