import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPASS_SLOTS,
  DEFAULT_COMPASS,
  compassOverrides,
  decodeCompassOverrides,
  isLastTrackSlot,
  resolveCompassMap,
} from "../../src/runtime/compass-map.ts";
import { parseDisplayProfileSettings } from "../../src/runtime/ui-profile.ts";
import {
  interactionWithHomeMode,
  resolveCompass,
  resolveHomeMode,
} from "../../src/runtime/presentation-target.ts";

test("classic default stores NOTHING - byte-stable", () => {
  assert.equal(compassOverrides(DEFAULT_COMPASS), undefined);
  assert.equal(compassOverrides(resolveCompassMap(undefined)), undefined);
  assert.equal(compassOverrides(resolveCompassMap(null)), undefined);
});

test("decode is tolerant: junk dropped, defaults normalised away", () => {
  assert.equal(decodeCompassOverrides(null), null);
  assert.equal(decodeCompassOverrides("x"), null);
  assert.equal(decodeCompassOverrides([]), null);
  assert.equal(decodeCompassOverrides({ up: "track" }), null); // == default
  assert.equal(decodeCompassOverrides({ diagonal: "art" }), null); // unknown slot
  assert.equal(decodeCompassOverrides({ up: "rainbow" }), null); // unknown action
  assert.deepEqual(decodeCompassOverrides({ right: "library", junk: 1 }), {
    right: "library",
  });
});

test("overrides round-trip through resolve", () => {
  const map = resolveCompassMap({ right: "library", center: "off" });
  assert.equal(map.right, "library");
  assert.equal(map.center, "off");
  assert.equal(map.up, "track"); // untouched slots keep defaults
  assert.deepEqual(compassOverrides(map), { right: "library", center: "off" });
});

test("Now-playing presence lock: resolver reinstates track on up", () => {
  // Stale/hand-edited data stripping every track slot cannot ship a
  // compass that loses the music.
  const map = resolveCompassMap({ up: "art" });
  assert.equal(map.up, "track");
  // But moving track to another slot is honoured (up freed).
  const moved = resolveCompassMap({ up: "art", down: "track" });
  assert.equal(moved.up, "art");
  assert.equal(moved.down, "track");
});

test("isLastTrackSlot guards exactly the last track", () => {
  assert.equal(isLastTrackSlot(DEFAULT_COMPASS, "up"), true);
  assert.equal(isLastTrackSlot(DEFAULT_COMPASS, "down"), false);
  const two = resolveCompassMap({ down: "track" });
  assert.equal(isLastTrackSlot(two, "up"), false); // a second track exists
  assert.equal(isLastTrackSlot(two, "down"), false);
});

test("navigation actions decode and resolve like any other", () => {
  const map = resolveCompassMap({ right: "favourites", down: "playlists" });
  assert.equal(map.right, "favourites");
  assert.equal(map.down, "playlists");
  assert.deepEqual(decodeCompassOverrides({ left: "playlists" }), { left: "playlists" });
});

test("homeMode override: stored per target, auto never stored, forces interaction", () => {
  const parsed = parseDisplayProfileSettings({
    byTarget: {
      "720x720@4": { homeMode: "full" },
      "480x272@4.3": { homeMode: "auto", smallLanding: "track" }, // auto normalised away
    },
    custom: { homeMode: "compass" },
  });
  assert.ok(parsed);
  assert.equal(parsed!.byTarget!["720x720@4"].homeMode, "full");
  assert.equal(parsed!.byTarget!["480x272@4.3"].homeMode, undefined);
  assert.equal(resolveHomeMode("720x720@4", parsed), "full");
  // Same chain as every display pref: target first, custom fallback.
  assert.equal(resolveHomeMode("480x272@4.3", parsed), "compass");
  assert.equal(resolveHomeMode(null, parsed), "compass");
  assert.equal(resolveHomeMode(null, null), "auto");
  // The override beats the heuristic in both directions; auto keeps it.
  assert.equal(interactionWithHomeMode("pivot", "full"), "standard");
  assert.equal(interactionWithHomeMode("standard", "compass"), "pivot");
  assert.equal(interactionWithHomeMode("pivot", "auto"), "pivot");
  assert.equal(interactionWithHomeMode("standard", "auto"), "standard");
});

test("ui.profile carries compass per target AND in the custom fallback", () => {
  const parsed = parseDisplayProfileSettings({
    byTarget: { "480x480@4": { compass: { right: "library" } } },
    custom: { compass: { center: "off" }, smallLanding: "track" },
  });
  assert.ok(parsed);
  assert.deepEqual(parsed!.byTarget!["480x480@4"].compass, { right: "library" });
  assert.deepEqual(parsed!.custom!.compass, { center: "off" });
  // Resolution chain: target key wins, custom is the fallback.
  assert.equal(resolveCompass("480x480@4", parsed).right, "library");
  assert.equal(resolveCompass("480x480@4", parsed).center, "device");
  assert.equal(resolveCompass(null, parsed).center, "off");
  // No data at all = the classic map on every slot.
  for (const slot of COMPASS_SLOTS) {
    assert.equal(resolveCompass(null, null)[slot], DEFAULT_COMPASS[slot]);
  }
});
