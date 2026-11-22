// Contract (A1): volume normalization is a mode, not a switch. The device
// stores and reports disabled, track or album on options.settings; the
// glass paints that token and writes exactly one request,
// options.set_volume_normalization { v: 1, mode }. The bool is gone from
// the control, the decoder and the setter. loudness_lufs is not offered
// anywhere on the glass. An old device that still says true / false is
// read the way the device reads its own old file: true is track, false is
// disabled.
// Run:
//   node --experimental-strip-types --test tests/contracts/volume-normalization-mode.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeAudioOptionsSettings } from "../../src/features/audio/audio-options-decoders.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const audioDir = join(root, "features", "audio");
const hook = readFileSync(join(audioDir, "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(audioDir, "AudioOptionsPanel.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

test("the decoder reads the three modes, the old bool, and defaults to disabled", () => {
  for (const mode of ["disabled", "track", "album"]) {
    const s = decodeAudioOptionsSettings({ v: 1, volume_normalization: mode });
    assert.equal(s?.volumeNormalization, mode);
  }
  assert.equal(decodeAudioOptionsSettings({ v: 1, volume_normalization: true })?.volumeNormalization, "track");
  assert.equal(decodeAudioOptionsSettings({ v: 1, volume_normalization: false })?.volumeNormalization, "disabled");
  assert.equal(decodeAudioOptionsSettings({ v: 1 })?.volumeNormalization, "disabled");
  assert.equal(decodeAudioOptionsSettings({ v: 1, volume_normalization: "auto" })?.volumeNormalization, "disabled");
});

test("the setter writes one request, { v: 1, mode }, on the write socket, then re-reads on the seed socket", () => {
  assert.ok(
    /const setVolumeNormalization = useCallback\(\s*async \(mode: VolumeNormalizationMode\)[\s\S]*?writeRequest\(\s*OPTIONS_SHELF,\s*"options\.set_volume_normalization",\s*\{ v: PAYLOAD_VERSION, mode \}\s*\)/.test(hook),
    "the write carries mode, not value"
  );
  assert.ok(
    !/dispatchSetter\("options\.set_volume_normalization"/.test(hook),
    "the bool envelope { v, value } is not used for this verb"
  );
  assert.ok(
    /const setVolumeNormalization = useCallback\([\s\S]*?const seed = transportRef\.current;\s*if \(seed !== null\) await refreshSettings\(seed\);/.test(hook),
    "the re-read is a read: seed socket"
  );
  assert.ok(/setVolumeNormalization: \(mode: VolumeNormalizationMode\)/.test(hook), "the hook's contract is the mode");
});

test("the control is the mode, never a bool, and offers exactly the three tokens", () => {
  assert.ok(!/id="audio-volume-normalization"[\s\S]{0,200}type="checkbox"/.test(panel), "the control is not a checkbox");
  assert.ok(/VOLUME_NORMALIZATION_MODES/.test(panel), "the control lists the modes");
  for (const key of ["audioopt.normalizationDisabled", "audioopt.normalizationTrack", "audioopt.normalizationAlbum"]) {
    assert.ok(panel.includes(key), key + " is offered");
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
  assert.ok(/value=\{settings\.volumeNormalization\}/.test(panel), "the painted mode is settings.volume_normalization");
});

test("loudness_lufs is not offered on the glass", () => {
  for (const f of readdirSync(audioDir)) {
    const src = readFileSync(join(audioDir, f), "utf8");
    assert.ok(!/loudness_lufs|loudnessLufs/i.test(src), f + " does not offer loudness");
  }
  assert.ok(!/lufs/i.test(en), "no loudness string in the catalogue");
});
