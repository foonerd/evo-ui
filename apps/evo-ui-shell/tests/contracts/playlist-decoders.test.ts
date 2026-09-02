// Contract tests for the audio.playlist decoders.

import test from "node:test";
import assert from "node:assert/strict";
import {
  RESERVED_FAVOURITES_PLAYLIST,
  decodePlaylistContents,
  decodePlaylistIndex,
  decodePlaylistIndexEntry,
  decodePlaylistIndexHappening,
  decodePlaylistItem,
  filterFavouritesOut,
  formatRelativeMs
} from "../../src/features/playlist/playlist-decoders.ts";

test("decodePlaylistIndexEntry decodes the live the rig entry shape", () => {
  const entry = decodePlaylistIndexEntry({
    item_count: 0,
    modified_at_ms: 1778966140000,
    name: "Playlist A"
  });
  assert.equal(entry?.name, "Playlist A");
  assert.equal(entry?.itemCount, 0);
  assert.equal(entry?.modifiedAtMs, 1778966140000);
});

test("decodePlaylistIndex decodes the live framework list (includes __favourites__)", () => {
  const index = decodePlaylistIndex({
    playlists: [
      {
        item_count: 0,
        modified_at_ms: 1780509375000,
        name: "__favourites__"
      },
      {
        item_count: 0,
        modified_at_ms: 1778966140000,
        name: "Playlist A"
      },
      {
        item_count: 5,
        modified_at_ms: 1779015499000,
        name: "Artist A"
      }
    ],
    v: 1
  });
  assert.equal(index?.playlists.length, 3);
  assert.equal(index?.playlists[0].name, "__favourites__");
  assert.equal(index?.playlists[2].itemCount, 5);
});

test("filterFavouritesOut drops the reserved favourites pseudo-playlist", () => {
  const filtered = filterFavouritesOut({
    playlists: [
      { name: RESERVED_FAVOURITES_PLAYLIST, itemCount: 1, modifiedAtMs: 0 },
      { name: "Playlist B", itemCount: 14, modifiedAtMs: 0 }
    ]
  });
  assert.equal(filtered.playlists.length, 1);
  assert.equal(filtered.playlists[0].name, "Playlist B");
});

test("decodePlaylistIndexHappening decodes audio_playlist_index state-changed", () => {
  const index = decodePlaylistIndexHappening({
    type: "subject_state_changed",
    subject_type: "audio_playlist_index",
    new_state: { v: 1, playlists: [{ name: "A", item_count: 0 }] }
  });
  assert.equal(index?.playlists.length, 1);
  assert.equal(index?.playlists[0].name, "A");
});

test("decodePlaylistIndexHappening ignores other subjects", () => {
  assert.equal(
    decodePlaylistIndexHappening({
      type: "subject_state_changed",
      subject_type: "audio_queue",
      new_state: {}
    }),
    null
  );
});

test("decodePlaylistItem decodes a populated track item", () => {
  const item = decodePlaylistItem({
    uri: "src-a/album-a/01.mp3",
    position: 0,
    source_id: "local-internal",
    title: "Things That Stop You Dreaming",
    artist: "Artist A",
    album: "Album A",
    duration_ms: 240000,
    artwork_url: "/art/album-a.jpg",
    available: true
  });
  assert.equal(item?.position, 0);
  assert.equal(item?.title, "Things That Stop You Dreaming");
  assert.equal(item?.durationMs, 240000);
  assert.equal(item?.artworkUrl, "/art/album-a.jpg");
});

test("decodePlaylistItem is tolerant on artwork_url: missing / empty / non-string all decode to null", () => {
  const missing = decodePlaylistItem({ uri: "a.mp3", position: 0 });
  assert.equal(missing?.artworkUrl, null);
  const empty = decodePlaylistItem({
    uri: "a.mp3",
    position: 0,
    artwork_url: ""
  });
  assert.equal(empty?.artworkUrl, null);
  const wrongType = decodePlaylistItem({
    uri: "a.mp3",
    position: 0,
    artwork_url: { href: "x" }
  });
  assert.equal(wrongType?.artworkUrl, null);
});

test("decodePlaylistItem rejects missing required fields", () => {
  assert.equal(decodePlaylistItem({ position: 0 }), null);
  assert.equal(decodePlaylistItem({ uri: "x" }), null);
});

test("decodePlaylistContents decodes the live the rig empty playlist response", () => {
  const c = decodePlaylistContents({
    item_count: 0,
    items: [],
    name: "Test Playlist",
    v: 1
  });
  assert.equal(c?.name, "Test Playlist");
  assert.equal(c?.itemCount, 0);
  assert.equal(c?.items.length, 0);
});

test("decodePlaylistContents rejects missing name", () => {
  assert.equal(decodePlaylistContents({ items: [] }), null);
});

test("formatRelativeMs renders the expected human-readable strings", () => {
  const now = 1780509725000;
  assert.equal(formatRelativeMs(now, now), "just now");
  assert.equal(formatRelativeMs(now - 30 * 1000, now), "just now");
  assert.equal(formatRelativeMs(now - 5 * 60 * 1000, now), "5m ago");
  assert.equal(formatRelativeMs(now - 3 * 60 * 60 * 1000, now), "3h ago");
  assert.equal(formatRelativeMs(now - 24 * 60 * 60 * 1000, now), "yesterday");
  assert.equal(formatRelativeMs(now - 3 * 24 * 60 * 60 * 1000, now), "3 days ago");
  assert.equal(formatRelativeMs(now - 14 * 24 * 60 * 60 * 1000, now), "2 weeks ago");
  assert.equal(formatRelativeMs(null), "-");
});
