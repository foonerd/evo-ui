// Contract: the mute glyph is the now_playing.muted flag.
// Muted is a red crossed speaker. Volume at 0 is not mute.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(join(here, "..", "..", "src", rel), "utf8");

const button = src("features/playback/VolumeMuteButton.tsx");
const stage = src("features/playback/StageSurface.tsx");
const playback = src("features/playback/PlaybackSurface.tsx");
const css = src("styles.css");

test("the mute class is attached only when muted", () => {
  assert.match(
    button,
    /return muted\s*\?\s*"playback-volume-icon playback-volume-icon-muted"\s*:\s*"playback-volume-icon"/
  );
});

test("the button paints VolumeX when muted and Volume2 when not", () => {
  assert.match(
    button,
    /muted \? <VolumeX size=\{size\} \/> : <Volume2 size=\{size\} \/>/
  );
  assert.match(button, /aria-pressed=\{muted\}/);
  assert.ok(!/volume === 0/.test(button), "slider zero is not the glyph");
});

test("the live stage and the pivot surface both use the one mute button", () => {
  assert.match(stage, /<VolumeMuteButton/);
  assert.match(playback, /<VolumeMuteButton/);
  assert.match(stage, /muted=\{muted\}/);
  assert.match(playback, /muted=\{nowPlaying\?\.muted === true\}/);
  assert.match(stage, /setMute\(!muted\)/);
  assert.match(playback, /setMute\(!muted\)/);
  assert.ok(!/setMute\(volume > 0\)/.test(stage));
  assert.ok(!/volume === 0 \? <VolumeX/.test(playback));
  assert.ok(!/<Volume2 size=\{16\} \/>/.test(stage));
});

test("muted beats the grey icon colour with the danger token", () => {
  assert.match(
    css,
    /\.playback-volume-icon\.playback-volume-icon-muted\s*\{[^}]*color:\s*var\(--danger/
  );
  assert.match(
    css,
    /\.playback-volume-icon\.playback-volume-icon-muted\s*\{[^}]*!important/
  );
});

test("mute and unmute labels are 7-bit catalog keys", () => {
  assert.equal(en["stage.mute"], "Mute");
  assert.equal(en["stage.unmute"], "Unmute");
  assert.ok(/^[\x20-\x7E]+$/.test(en["stage.mute"]));
  assert.ok(/^[\x20-\x7E]+$/.test(en["stage.unmute"]));
  assert.match(stage, /t\("stage\.unmute"\)/);
  assert.match(playback, /t\("stage\.unmute"\)/);
});
