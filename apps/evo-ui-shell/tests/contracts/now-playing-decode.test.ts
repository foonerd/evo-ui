// Contract tests for the evo.audio.playback now_playing decoders.
//
// Each test synthesises the wire frame the framework emits - the
// subject_state_changed happening carrying the now_playing
// subject's new_state - and asserts the decoded shape, so the
// centre-stage transport readout is verifiable without live
// playback.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeNowPlaying,
  decodeNowPlayingTrack,
  decodeNowPlayingHappening,
  interpolateElapsedMs
} from "../../src/features/playback/now-playing-decoders.ts";

// --- decodeNowPlaying: valid playing payload ----------------------

test("decodeNowPlaying decodes a full playing payload", () => {
  const np = decodeNowPlaying({
    v: 1,
    transport_state: "playing",
    track: {
      title: "Track B",
      artist: "Artist B",
      album: "Album B",
      mpd_path: "src-a/album-b/01.flac",
      artwork_url: "/api/v1/audio/artwork/by-mpd-path/abc123/large"
    },
    elapsed_ms: 134000,
    duration_ms: 228000,
    volume: 64,
    muted: false,
    repeat: true,
    shuffle: false,
    single: false,
    consume: true
  });
  assert.notEqual(np, null);
  assert.equal(np?.transportState, "playing");
  assert.deepEqual(np?.track, {
    title: "Track B",
    artist: "Artist B",
    album: "Album B",
    mpdPath: "src-a/album-b/01.flac",
    artworkUrl: "/api/v1/audio/artwork/by-mpd-path/abc123/large",
    classical: null
  });
  assert.equal(np?.elapsedMs, 134000);
  assert.equal(np?.durationMs, 228000);
  assert.equal(np?.volume, 64);
  assert.equal(np?.muted, false);
  assert.equal(np?.repeat, true);
  assert.equal(np?.consume, true);
});

// --- decodeNowPlaying: the three transport states -----------------

test("decodeNowPlaying accepts each of the three transport states", () => {
  for (const state of ["playing", "paused", "stopped"] as const) {
    const np = decodeNowPlaying({
      v: 1,
      transport_state: state,
      track:
        state === "stopped"
          ? null
          : { title: "T", artist: "A", album: "B", mpd_path: "p.flac" },
      elapsed_ms: state === "stopped" ? null : 1000,
      duration_ms: state === "stopped" ? null : 200000,
      volume: 50,
      muted: false,
      repeat: false,
      shuffle: false,
      single: false,
      consume: false
    });
    assert.equal(np?.transportState, state);
  }
});

test("decodeNowPlaying rejects an unknown transport state", () => {
  assert.equal(
    decodeNowPlaying({ v: 1, transport_state: "buffering", volume: 0 }),
    null
  );
});

// --- decodeNowPlaying: null track when stopped --------------------

test("decodeNowPlaying yields a null track when stopped", () => {
  const np = decodeNowPlaying({
    v: 1,
    transport_state: "stopped",
    track: null,
    elapsed_ms: null,
    duration_ms: null,
    volume: 30,
    muted: false,
    repeat: false,
    shuffle: false,
    single: false,
    consume: false
  });
  assert.notEqual(np, null);
  assert.equal(np?.track, null);
  assert.equal(np?.elapsedMs, null);
  assert.equal(np?.durationMs, null);
});

// --- decodeNowPlaying: absent / null Option fields ----------------

test("decodeNowPlaying treats absent/null Option track fields as null", () => {
  // title / artist / album each null on the wire.
  const npNullTags = decodeNowPlaying({
    v: 1,
    transport_state: "playing",
    track: {
      title: null,
      artist: null,
      album: null,
      mpd_path: "untagged/track.flac"
    },
    elapsed_ms: 0,
    duration_ms: 90000,
    volume: 20,
    muted: false,
    repeat: false,
    shuffle: false,
    single: false,
    consume: false
  });
  assert.deepEqual(npNullTags?.track, {
    title: null,
    artist: null,
    album: null,
    mpdPath: "untagged/track.flac",
    artworkUrl: null,
    classical: null
  });

  // title / artist / album entirely absent from the track object.
  const npAbsentTags = decodeNowPlaying({
    v: 1,
    transport_state: "paused",
    track: { mpd_path: "bare/track.flac" },
    elapsed_ms: null,
    duration_ms: null,
    volume: 70,
    muted: true,
    repeat: false,
    shuffle: false,
    single: false,
    consume: false
  });
  assert.equal(npAbsentTags?.track?.title, null);
  assert.equal(npAbsentTags?.track?.artist, null);
  assert.equal(npAbsentTags?.track?.album, null);
  assert.equal(npAbsentTags?.track?.mpdPath, "bare/track.flac");
  assert.equal(npAbsentTags?.muted, true);
});

test("decodeNowPlayingTrack rejects a track missing mpd_path", () => {
  assert.equal(
    decodeNowPlayingTrack({ title: "No Handle", artist: "X" }),
    null
  );
  assert.equal(decodeNowPlayingTrack(null), null);
});

test("decodeNowPlaying defaults volume when absent or non-numeric", () => {
  const np = decodeNowPlaying({
    v: 1,
    transport_state: "stopped",
    track: null
  });
  assert.equal(np?.volume, 0);
});

// --- decodeNowPlaying: non-object input ---------------------------

test("decodeNowPlaying returns null for non-object input", () => {
  assert.equal(decodeNowPlaying(null), null);
  assert.equal(decodeNowPlaying(42), null);
  assert.equal(decodeNowPlaying("playing"), null);
  assert.equal(decodeNowPlaying([1, 2, 3]), null);
});

// --- decodeNowPlayingHappening ------------------------------------

function nowPlayingHappening(newState: unknown): Record<string, unknown> {
  return {
    type: "subject_state_changed",
    subject_type: "audio_playback_now_playing",
    canonical_id: "111c7264-528b-4cb7-8f75-40229cfbe012",
    prev_state: null,
    new_state: newState,
    at_ms: 1716400000000
  };
}

test("decodeNowPlayingHappening decodes a now_playing subject_state_changed", () => {
  const np = decodeNowPlayingHappening(
    nowPlayingHappening({
      v: 1,
      transport_state: "playing",
      track: { title: "Track B", artist: "Artist B", album: "Album B", mpd_path: "p.flac" },
      elapsed_ms: 1000,
      duration_ms: 200000,
      volume: 55,
      muted: false,
      repeat: false,
      shuffle: false,
      single: false,
      consume: false
    })
  );
  assert.notEqual(np, null);
  assert.equal(np?.transportState, "playing");
  assert.equal(np?.track?.title, "Track B");
});

test("decodeNowPlayingHappening unwraps a { happening: ... } envelope", () => {
  const np = decodeNowPlayingHappening({
    happening: nowPlayingHappening({
      v: 1,
      transport_state: "stopped",
      track: null,
      elapsed_ms: null,
      duration_ms: null,
      volume: 0,
      muted: false,
      repeat: false,
      shuffle: false,
      single: false,
      consume: false
    })
  });
  assert.equal(np?.transportState, "stopped");
});

test("decodeNowPlayingHappening ignores other subjects and other happenings", () => {
  // Right happening type, wrong subject.
  const other = nowPlayingHappening({ v: 1, transport_state: "playing", volume: 0 });
  other["subject_type"] = "audio_playback_stream_format";
  assert.equal(decodeNowPlayingHappening(other), null);
  // Wrong happening type.
  assert.equal(
    decodeNowPlayingHappening({ type: "plugin_reload_dispatched" }),
    null
  );
  // Non-object input.
  assert.equal(decodeNowPlayingHappening(null), null);
});

// --- interpolateElapsedMs: live progress between sparse updates ---

test("interpolateElapsedMs advances by wall-clock while playing", () => {
  const anchor = { elapsedMs: 10_000, atMs: 1_000_000 };
  // 2.5s of wall-clock after the anchor, still playing.
  assert.equal(
    interpolateElapsedMs(anchor, 1_002_500, true, 228_000),
    12_500
  );
});

test("interpolateElapsedMs holds at the anchor when not playing", () => {
  const anchor = { elapsedMs: 42_000, atMs: 1_000_000 };
  // 30s of wall-clock pass, but transport is paused - position holds.
  assert.equal(
    interpolateElapsedMs(anchor, 1_030_000, false, 228_000),
    42_000
  );
});

test("interpolateElapsedMs caps the position at the track duration", () => {
  const anchor = { elapsedMs: 220_000, atMs: 1_000_000 };
  // 60s of advance would overrun the 228s track; clamp to duration.
  assert.equal(
    interpolateElapsedMs(anchor, 1_060_000, true, 228_000),
    228_000
  );
});

test("interpolateElapsedMs does not cap when duration is unknown", () => {
  const anchor = { elapsedMs: 5_000, atMs: 1_000_000 };
  // Null duration (stream / not yet known) - advance uncapped.
  assert.equal(
    interpolateElapsedMs(anchor, 1_010_000, true, null),
    15_000
  );
  // A non-positive duration is treated as unknown.
  assert.equal(interpolateElapsedMs(anchor, 1_010_000, true, 0), 15_000);
});

test("interpolateElapsedMs floors at zero and ignores a backwards clock", () => {
  const anchor = { elapsedMs: 8_000, atMs: 1_000_000 };
  // A clock that reads earlier than the anchor must not rewind the
  // displayed position below the anchored value.
  assert.equal(
    interpolateElapsedMs(anchor, 999_000, true, 228_000),
    8_000
  );
  // A negative anchored position still floors at 0.
  assert.equal(
    interpolateElapsedMs({ elapsedMs: -500, atMs: 1_000_000 }, 1_000_000, false, null),
    0
  );
});
