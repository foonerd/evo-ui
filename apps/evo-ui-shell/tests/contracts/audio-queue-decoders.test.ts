// Contract tests for the audio.queue decoders. Each test synthesises
// the wire frame the framework emits (per queue.rs:217-279 in the
// playback.mpd plugin) and asserts the decoded shape.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeQueueItem,
  decodeQueueState,
  decodeQueueStateHappening,
  decodeSkipOutcome,
  formatDurationMs,
  codecFromUri
} from "../../src/features/queue/audio-queue-decoders.ts";

// --- decodeQueueItem ---------------------------------------------

test("decodeQueueItem decodes a populated item", () => {
  const item = decodeQueueItem({
    id: 42,
    position: 3,
    uri: "src-a/album-a/track-a.mp3",
    source_id: "src-a",
    title: "Track A",
    artist: "Artist A",
    album: "Album A",
    duration_ms: 236000,
    artwork_url: "/art/src-a/album-a.jpg",
    available: true
  });
  assert.deepEqual(item, {
    id: 42,
    position: 3,
    uri: "src-a/album-a/track-a.mp3",
    sourceId: "src-a",
    title: "Track A",
    artist: "Artist A",
    album: "Album A",
    durationMs: 236000,
    artworkUrl: "/art/src-a/album-a.jpg",
    available: true,
    classical: null
  });
});

test("decodeQueueItem is tolerant on artwork_url: missing / empty / non-string all decode to null", () => {
  const missing = decodeQueueItem({ id: 1, position: 0, uri: "a.mp3" });
  assert.equal(missing?.artworkUrl, null);
  const empty = decodeQueueItem({
    id: 1,
    position: 0,
    uri: "a.mp3",
    artwork_url: ""
  });
  assert.equal(empty?.artworkUrl, null);
  const wrongType = decodeQueueItem({
    id: 1,
    position: 0,
    uri: "a.mp3",
    artwork_url: 42
  });
  assert.equal(wrongType?.artworkUrl, null);
});

test("decodeQueueItem decodes a tag-less stream URL item", () => {
  const item = decodeQueueItem({
    id: 7,
    position: 0,
    uri: "http://stream.live.vc.bbcmedia.co.uk/bbc_6music",
    source_id: null,
    title: null,
    artist: null,
    album: null,
    duration_ms: null,
    available: true
  });
  assert.equal(item?.uri, "http://stream.live.vc.bbcmedia.co.uk/bbc_6music");
  assert.equal(item?.title, null);
  assert.equal(item?.sourceId, null);
  assert.equal(item?.durationMs, null);
});

test("decodeQueueItem yields null available when the field is absent", () => {
  // Framework contract (audio.queue.v1 + PLUGIN_CONTRACT.md §15):
  // missing/null available means "truth not yet determined". The
  // decoder MUST preserve null; the legacy fallback-to-true pattern
  // is forbidden by the catalogue acceptance row
  // queue-item-available-cascade-emits-null-on-unknown.
  const item = decodeQueueItem({
    id: 1,
    position: 0,
    uri: "INTERNAL/test.mp3"
  });
  assert.equal(item?.available, null);
});

test("decodeQueueItem preserves explicit available=true", () => {
  const item = decodeQueueItem({
    id: 1,
    position: 0,
    uri: "INTERNAL/test.mp3",
    available: true
  });
  assert.equal(item?.available, true);
});

test("decodeQueueItem preserves explicit available=false (KNOWN unreachable)", () => {
  const item = decodeQueueItem({
    id: 1,
    position: 0,
    uri: "INTERNAL/test.mp3",
    available: false
  });
  assert.equal(item?.available, false);
});

test("decodeQueueItem rejects items missing required id / position / uri", () => {
  assert.equal(decodeQueueItem({ position: 0, uri: "x" }), null);
  assert.equal(decodeQueueItem({ id: 1, uri: "x" }), null);
  assert.equal(decodeQueueItem({ id: 1, position: 0 }), null);
  assert.equal(decodeQueueItem(null), null);
  assert.equal(decodeQueueItem("string"), null);
});

// --- decodeQueueState --------------------------------------------

test("decodeQueueState decodes a populated envelope", () => {
  const state = decodeQueueState({
    v: 1,
    items: [
      { id: 1, position: 0, uri: "a.mp3", available: true },
      { id: 2, position: 1, uri: "b.mp3", available: true }
    ],
    length: 2,
    current_position: 0
  });
  assert.equal(state?.length, 2);
  assert.equal(state?.currentPosition, 0);
  assert.equal(state?.truncated, false);
  assert.equal(state?.items.length, 2);
  assert.equal(state?.items[0].id, 1);
  assert.equal(state?.items[1].id, 2);
});

test("decodeQueueState decodes the empty seed envelope (the seed state framework publishes at announce)", () => {
  const state = decodeQueueState({
    v: 1,
    items: [],
    length: 0,
    current_position: null
  });
  assert.notEqual(state, null);
  assert.equal(state?.length, 0);
  assert.equal(state?.currentPosition, null);
  assert.equal(state?.items.length, 0);
});

test("decodeQueueState surfaces the truncated flag", () => {
  const state = decodeQueueState({
    v: 1,
    items: [{ id: 1, position: 0, uri: "a.mp3", available: true }],
    length: 5000,
    current_position: 12,
    truncated: true
  });
  assert.equal(state?.truncated, true);
  assert.equal(state?.length, 5000);
  assert.equal(state?.items.length, 1);
});

test("decodeQueueState drops items that fail decode but keeps the envelope", () => {
  const state = decodeQueueState({
    v: 1,
    items: [
      { id: 1, position: 0, uri: "a.mp3", available: true },
      { id: "garbled", position: 1, uri: "b.mp3" },
      { id: 3, position: 2, uri: "c.mp3", available: false }
    ],
    length: 3,
    current_position: 0
  });
  assert.equal(state?.items.length, 2);
  assert.equal(state?.items[0].id, 1);
  assert.equal(state?.items[1].id, 3);
  assert.equal(state?.length, 3);
});

test("decodeQueueState rejects non-object input", () => {
  assert.equal(decodeQueueState(null), null);
  assert.equal(decodeQueueState(undefined), null);
  assert.equal(decodeQueueState("not an object"), null);
  assert.equal(decodeQueueState([]), null);
});

// --- decodeQueueStateHappening -----------------------------------

test("decodeQueueStateHappening decodes a subject_state_changed for audio_queue", () => {
  const state = decodeQueueStateHappening({
    type: "subject_state_changed",
    subject_type: "audio_queue",
    canonical_id: "evo.audio.queue:queue",
    new_state: {
      v: 1,
      items: [{ id: 1, position: 0, uri: "x.mp3", available: true }],
      length: 1,
      current_position: null
    },
    at_ms: 1700000000000
  });
  assert.equal(state?.items.length, 1);
});

test("decodeQueueStateHappening unwraps a leading { happening: ... } envelope", () => {
  const state = decodeQueueStateHappening({
    happening: {
      type: "subject_state_changed",
      subject_type: "audio_queue",
      new_state: { v: 1, items: [], length: 0, current_position: null }
    }
  });
  assert.notEqual(state, null);
  assert.equal(state?.items.length, 0);
});

test("decodeQueueStateHappening ignores other subjects and other happenings", () => {
  assert.equal(
    decodeQueueStateHappening({
      type: "subject_state_changed",
      subject_type: "audio_playback_now_playing",
      new_state: {}
    }),
    null
  );
  assert.equal(
    decodeQueueStateHappening({ type: "custody_taken" }),
    null
  );
});

// --- decodeSkipOutcome -------------------------------------------

test("decodeSkipOutcome decodes the playing outcome", () => {
  const outcome = decodeSkipOutcome({
    outcome: { kind: "playing", songid: 42, position: 3 }
  });
  assert.deepEqual(outcome, { kind: "playing", songid: 42, position: 3 });
});

test("decodeSkipOutcome decodes the stopped outcome with reason", () => {
  const outcome = decodeSkipOutcome({
    outcome: { kind: "stopped", reason: "all_items_unavailable" }
  });
  assert.deepEqual(outcome, {
    kind: "stopped",
    reason: "all_items_unavailable"
  });
});

test("decodeSkipOutcome rejects unknown kind tokens", () => {
  assert.equal(decodeSkipOutcome({ outcome: { kind: "garbled" } }), null);
  assert.equal(decodeSkipOutcome({}), null);
});

// --- formatDurationMs --------------------------------------------

test("formatDurationMs formats sub-hour durations as m:ss", () => {
  assert.equal(formatDurationMs(236000), "3:56");
  assert.equal(formatDurationMs(60000), "1:00");
  assert.equal(formatDurationMs(9000), "0:09");
});

test("formatDurationMs formats over-hour durations as h:mm:ss", () => {
  assert.equal(formatDurationMs(3661000), "1:01:01");
  assert.equal(formatDurationMs(7200000), "2:00:00");
});

test("formatDurationMs renders null as -", () => {
  assert.equal(formatDurationMs(null), "-");
});

// --- codecFromUri ------------------------------------------------

test("codecFromUri maps known file extensions to upper-case labels", () => {
  assert.equal(codecFromUri("a/b/c.mp3"), "MP3");
  assert.equal(codecFromUri("a/b/c.flac"), "FLAC");
  assert.equal(codecFromUri("a/b/c.dsf"), "DSF");
  assert.equal(codecFromUri("a/b/c.dff"), "DFF");
  assert.equal(codecFromUri("a/b/c.opus"), "OPUS");
});

test("codecFromUri returns null for URIs without an extension", () => {
  assert.equal(codecFromUri("http://stream.example.com/live"), null);
  assert.equal(codecFromUri("noextension"), null);
});

test("codecFromUri is case-insensitive on the extension", () => {
  assert.equal(codecFromUri("a/b/c.FLAC"), "FLAC");
  assert.equal(codecFromUri("a/b/c.Mp3"), "MP3");
});
