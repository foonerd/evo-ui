// Contract tests for the audio.favourites decoders. Wire shape
// captured live on the rig against the deployed binary.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeFavouriteItem,
  decodeFavouritesState,
  decodeFavouritesStateHappening,
  decodeIsFavourite
} from "../../src/features/favourites/favourites-decoders.ts";

test("decodeFavouriteItem decodes a populated item from the rig", () => {
  const item = decodeFavouriteItem({
    added_at_ms: null,
    album: "Album A",
    artist: "Artist A",
    available: true,
    duration_ms: 252733,
    position: 0,
    source_id: "src-a",
    title: "Track A",
    uri: "src-a/album-a/track-a.mp3",
    artwork_url: "/art/album-a.jpg"
  });
  assert.equal(item?.uri, "src-a/album-a/track-a.mp3");
  assert.equal(item?.position, 0);
  assert.equal(item?.addedAtMs, null);
  assert.equal(item?.title, "Track A");
  assert.equal(item?.durationMs, 252733);
  assert.equal(item?.available, true);
  assert.equal(item?.artworkUrl, "/art/album-a.jpg");
});

test("decodeFavouriteItem decodes a stream-URL item with null metadata", () => {
  const item = decodeFavouriteItem({
    uri: "http://stream.example.com/live",
    position: 3,
    available: true
  });
  assert.equal(item?.title, null);
  assert.equal(item?.durationMs, null);
  assert.equal(item?.artworkUrl, null); // absent -> null, tile placeholder
});

test("decodeFavouriteItem yields null available when the field is absent", () => {
  // Framework contract (audio.favourites.v1 + PLUGIN_CONTRACT.md §15):
  // missing/null available means "truth not yet determined". The
  // decoder MUST preserve null; the legacy fallback-to-true pattern
  // is forbidden by favourites-item-available-cascade-emits-null-on-unknown.
  const item = decodeFavouriteItem({ uri: "x", position: 0 });
  assert.equal(item?.available, null);
});

test("decodeFavouriteItem preserves explicit available=true", () => {
  const item = decodeFavouriteItem({ uri: "x", position: 0, available: true });
  assert.equal(item?.available, true);
});

test("decodeFavouriteItem preserves explicit available=false (KNOWN unreachable)", () => {
  const item = decodeFavouriteItem({ uri: "x", position: 0, available: false });
  assert.equal(item?.available, false);
});

test("decodeFavouriteItem rejects missing required fields", () => {
  assert.equal(decodeFavouriteItem({ position: 0 }), null);
  assert.equal(decodeFavouriteItem({ uri: "x" }), null);
  assert.equal(decodeFavouriteItem(null), null);
});

test("decodeFavouritesState decodes the live framework list response", () => {
  const state = decodeFavouritesState({
    count: 1,
    items: [
      {
        added_at_ms: null,
        album: "Album A",
        artist: "Artist A",
        available: true,
        duration_ms: 252733,
        position: 0,
        source_id: "src-a",
        title: "Track A",
        uri: "src-a/album-a/track-a.mp3"
      }
    ],
    v: 1
  });
  assert.equal(state?.count, 1);
  assert.equal(state?.items.length, 1);
});

test("decodeFavouritesState decodes an empty list", () => {
  const state = decodeFavouritesState({ count: 0, items: [], v: 1 });
  assert.equal(state?.count, 0);
  assert.equal(state?.items.length, 0);
});

test("decodeFavouritesState drops bad rows without failing the envelope", () => {
  const state = decodeFavouritesState({
    count: 2,
    items: [
      { uri: "x", position: 0, available: true },
      { position: 1 }
    ]
  });
  assert.equal(state?.items.length, 1);
  assert.equal(state?.count, 2);
});

test("decodeFavouritesStateHappening decodes a subject_state_changed for audio_favourites", () => {
  const state = decodeFavouritesStateHappening({
    type: "subject_state_changed",
    subject_type: "audio_favourites",
    new_state: { v: 1, count: 0, items: [] }
  });
  assert.equal(state?.count, 0);
});

test("decodeFavouritesStateHappening ignores other subjects", () => {
  assert.equal(
    decodeFavouritesStateHappening({
      type: "subject_state_changed",
      subject_type: "audio_queue",
      new_state: {}
    }),
    null
  );
});

test("decodeIsFavourite decodes the live the rig response", () => {
  const r = decodeIsFavourite({
    v: 1,
    uri: "src-a/album-a/track-a.mp3",
    is_favourite: true
  });
  assert.equal(r?.uri, "src-a/album-a/track-a.mp3");
  assert.equal(r?.isFavourite, true);
});

test("decodeIsFavourite defaults is_favourite to false on missing field", () => {
  const r = decodeIsFavourite({ v: 1, uri: "x" });
  assert.equal(r?.isFavourite, false);
});
