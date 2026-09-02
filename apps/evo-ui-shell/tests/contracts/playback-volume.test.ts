import test from "node:test";
import assert from "node:assert/strict";
import {
  clampVolume,
  nextVolumeFromDelta,
  PLAYBACK_VOLUME_STEP,
  resolveMuteToggleVolume
} from "../../src/core/playback-volume.ts";

test("clampVolume clamps to 0..100 and handles non-finite values", () => {
  assert.equal(clampVolume(-10), 0);
  assert.equal(clampVolume(55.4), 55);
  assert.equal(clampVolume(999), 100);
  assert.equal(clampVolume(Number.NaN), 40);
});

test("nextVolumeFromDelta uses fallback baseline and step math", () => {
  assert.equal(nextVolumeFromDelta(undefined, PLAYBACK_VOLUME_STEP), 45);
  assert.equal(nextVolumeFromDelta(98, PLAYBACK_VOLUME_STEP), 100);
  assert.equal(nextVolumeFromDelta(2, -PLAYBACK_VOLUME_STEP), 0);
});

test("resolveMuteToggleVolume mutes when current volume is active", () => {
  const outcome = resolveMuteToggleVolume(37, 22);
  assert.deepEqual(outcome, {
    targetVolume: 0,
    nextRememberedVolume: 37
  });
});

test("resolveMuteToggleVolume restores remembered/default level from mute", () => {
  assert.deepEqual(resolveMuteToggleVolume(0, 26), {
    targetVolume: 26,
    nextRememberedVolume: 26
  });
  assert.deepEqual(resolveMuteToggleVolume(0, 0), {
    targetVolume: 40,
    nextRememberedVolume: 40
  });
});
