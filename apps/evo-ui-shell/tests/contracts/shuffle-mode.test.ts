// Contract (A2 + A3): shuffle is off, by track, by album, or similar, and
// the control shows that mode. One write: set_shuffle { mode: "off" |
// "tracks" | "albums" | "similar" } - never { enabled } from the control,
// never both.
// now_playing.shuffle is MPD's random flag: true can only be track shuffle,
// false is off OR album shuffle, so the glass never paints album (or off)
// from it. The painted mode is the reported shuffle_mode; without it,
// random true paints by track and random false paints nothing - the
// control does not guess.
// Run:
//   node --experimental-strip-types --test tests/contracts/shuffle-mode.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeNowPlaying } from "../../src/features/playback/now-playing-decoders.ts";
import {
  SHUFFLE_MODES,
  nextShuffleMode,
  paintedShuffleMode
} from "../../src/features/playback/shuffle-mode.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const hook = readFileSync(join(root, "features", "playback", "usePlayback.ts"), "utf8");
const playback = readFileSync(join(root, "features", "playback", "PlaybackSurface.tsx"), "utf8");
const stage = readFileSync(join(root, "features", "playback", "StageSurface.tsx"), "utf8");
const cache = readFileSync(join(root, "features", "playback", "now-playing-cache.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function np(extra: Record<string, unknown>) {
  const decoded = decodeNowPlaying({ v: 1, transport_state: "playing", track: null, ...extra });
  assert.ok(decoded !== null);
  return decoded;
}

test("the reported shuffle_mode decodes to its three tokens, absent is null", () => {
  assert.equal(np({ shuffle_mode: "off", shuffle: false }).shuffleMode, "off");
  assert.equal(np({ shuffle_mode: "tracks", shuffle: true }).shuffleMode, "tracks");
  assert.equal(np({ shuffle_mode: "albums", shuffle: false }).shuffleMode, "albums");
  assert.equal(np({ shuffle_mode: "similar", shuffle: false }).shuffleMode, "similar");
  assert.equal(np({ shuffle: false }).shuffleMode, null);
  assert.equal(np({ shuffle_mode: "smart", shuffle: false }).shuffleMode, null);
});

test("the painted mode is the reported mode; random alone paints tracks or nothing, never album or similar", () => {
  assert.equal(paintedShuffleMode(np({ shuffle_mode: "albums", shuffle: false })), "albums");
  assert.equal(paintedShuffleMode(np({ shuffle_mode: "similar", shuffle: false })), "similar");
  assert.equal(paintedShuffleMode(np({ shuffle_mode: "off", shuffle: false })), "off");
  assert.equal(paintedShuffleMode(np({ shuffle: true })), "tracks");
  assert.equal(paintedShuffleMode(np({ shuffle: false })), null, "random false is off, albums or similar: not reported");
  assert.equal(paintedShuffleMode(null), null);
});

test("the control cycles off, tracks, albums, similar; an unreported mode starts at tracks", () => {
  assert.deepEqual([...SHUFFLE_MODES], ["off", "tracks", "albums", "similar"]);
  assert.equal(nextShuffleMode("off"), "tracks");
  assert.equal(nextShuffleMode("tracks"), "albums");
  assert.equal(nextShuffleMode("albums"), "similar");
  assert.equal(nextShuffleMode("similar"), "off");
  assert.equal(nextShuffleMode(null), "tracks");
});

test("the hook writes set_shuffle { mode } once, never { enabled }, never both", () => {
  assert.ok(/dispatchVerb\("set_shuffle", \{ mode \}\)/.test(hook), "the write carries mode");
  assert.ok(!/dispatchVerb\("set_shuffle", \{ enabled/.test(hook), "no enabled write from the glass");
  assert.ok(!/set_shuffle", \{[^}]*enabled[^}]*mode|set_shuffle", \{[^}]*mode[^}]*enabled/.test(hook), "never both");
  assert.ok(/setShuffleMode: \(mode: ShuffleMode\)/.test(hook), "the hook's contract is the mode");
  assert.ok(!/setShuffle: \(enabled: boolean\)/.test(hook), "the bool setter is gone");
});

test("both surfaces paint and cycle the mode, never toggle the random flag", () => {
  for (const [name, src] of [["PlaybackSurface", playback], ["StageSurface", stage]] as const) {
    assert.ok(/paintedShuffleMode\(/.test(src), name + " paints the reported mode");
    assert.ok(/setShuffleMode\(nextShuffleMode\(/.test(src), name + " cycles to the next mode");
    assert.ok(!/setShuffle\(!shuffleOn\)/.test(src), name + " does not toggle the random flag");
    assert.ok(/shuffleMode === "similar"/.test(src), name + " paints similar from the reported mode only");
    assert.ok(!/nowPlaying\?\.shuffle \?\? false/.test(src), name + " does not read the random flag as the mode");
  }
});

test("the cache carries the reported mode, and the three labels are ASCII", () => {
  assert.ok(/shuffle_mode: state\.shuffleMode/.test(cache), "the cache round-trips shuffle_mode");
  for (const key of ["stage.shuffleOff", "stage.shuffleTracks", "stage.shuffleAlbums", "stage.shuffleSimilar", "stage.shuffleSimilarBadge"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});
