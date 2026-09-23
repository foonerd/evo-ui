// Contract: a failed now_playing boot seed retries once.
// Run: node --experimental-strip-types --test tests/contracts/playback-seed.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PLAYBACK_NOW_PLAYING_SEED_ATTEMPTS,
  PLAYBACK_NOW_PLAYING_SEED_RETRY_MS,
  playbackNowPlayingSeedShouldRetry
} from "../../src/features/playback/playback-seed.ts";

const here = dirname(fileURLToPath(import.meta.url));
const session = readFileSync(
  join(here, "..", "..", "src", "features", "playback", "playback-session.ts"),
  "utf8"
);

test("a failed seed retries; a successful idle seed does not", () => {
  assert.equal(PLAYBACK_NOW_PLAYING_SEED_ATTEMPTS, 2);
  assert.equal(PLAYBACK_NOW_PLAYING_SEED_RETRY_MS, 1_500);
  assert.equal(playbackNowPlayingSeedShouldRetry(true, 1), true);
  assert.equal(playbackNowPlayingSeedShouldRetry(true, 2), false);
  assert.equal(
    playbackNowPlayingSeedShouldRetry(false, 1),
    false,
    "idle / decoded success is the truth"
  );
});

test("the session retries get_now_playing on error only", () => {
  assert.ok(
    /playbackNowPlayingSeedShouldRetry\(true, attempt\)/.test(session),
    "retry is gated on a failed seed"
  );
  assert.ok(
    /PLAYBACK_NOW_PLAYING_SEED_ATTEMPTS/.test(session),
    "the bound lives in the session seed loop"
  );
  const streamSeed = session.slice(
    session.indexOf("const seedStreamFormat"),
    session.indexOf("void seedNowPlaying")
  );
  assert.ok(
    !/SEED_ATTEMPTS/.test(streamSeed),
    "stream-format seed is not this row"
  );
});
