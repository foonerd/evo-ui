// Connection chrome policy: quiet healthy F5, loud on real degrade.

import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowPlaybackConnectionPopup,
  playbackConnectionHeadline
} from "../../src/features/playback/playback-connection-policy.ts";
import type { NowPlaying } from "../../src/features/playback/now-playing-decoders.ts";

const lastKnown: NowPlaying = {
  transportState: "playing",
  track: {
    title: "T",
    artist: "A",
    album: "B",
    mpdPath: "x.flac",
    artworkUrl: null,
    classical: null
  },
  elapsedMs: 1000,
  durationMs: 200000,
  volume: 40,
  muted: false,
  repeat: false,
  shuffle: false,
  single: false,
  consume: false
};

test("healthy connecting never raises a maintenance popup", () => {
  assert.equal(
    shouldShowPlaybackConnectionPopup({ kind: "connecting" }, null),
    false
  );
  assert.equal(
    shouldShowPlaybackConnectionPopup({ kind: "connecting", attempt: 1 }, lastKnown),
    false
  );
});

test("connected never raises a popup", () => {
  assert.equal(
    shouldShowPlaybackConnectionPopup({ kind: "connected" }, lastKnown),
    false
  );
});

test("error always raises a popup (restart / upgrade / maintenance)", () => {
  assert.equal(
    shouldShowPlaybackConnectionPopup(
      { kind: "error", reason: "service restarting" },
      lastKnown
    ),
    true
  );
  assert.equal(
    shouldShowPlaybackConnectionPopup(
      { kind: "error", reason: "service restarting" },
      null
    ),
    true
  );
  assert.match(
    playbackConnectionHeadline({ kind: "error", reason: "x" }),
    /unavailable/i
  );
});

test("disconnected after live session raises reconnect popup", () => {
  assert.equal(
    shouldShowPlaybackConnectionPopup(
      { kind: "disconnected", reason: "socket closed" },
      lastKnown
    ),
    true
  );
  assert.match(
    playbackConnectionHeadline({ kind: "disconnected" }),
    /Reconnecting/i
  );
});
