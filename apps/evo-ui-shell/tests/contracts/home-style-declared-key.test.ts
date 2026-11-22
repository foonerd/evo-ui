// Contract: the panel shows the home that was applied. The designer's
// Apply writes the home style under the DECLARED native_target key; on a
// real panel the measured key drifts from it (DPR, zoom, rotation), so the
// glass resolves the home style off the declared key, the same key the
// dials and the native layout use. Full layout applied for a 7 inch
// 800x480 panel means that panel is not left on the compass. Compass
// stays available when Compass is the selected home, and the size
// heuristic still decides when nothing was applied.
// Run:
//   node --experimental-strip-types --test tests/contracts/home-style-declared-key.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseDisplayProfileSettings } from "../../src/runtime/ui-profile.ts";
import { buildPresentationPlan } from "../../src/runtime/presentation-target.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const target = readFileSync(join(root, "runtime", "presentation-target.ts"), "utf8");

// The declared native target the designer's Apply wrote for the 7 inch
// 800x480 panel, and the CSS viewport that panel actually measures once
// the kiosk's scale is on it: a smaller box, whose own key is different
// and whose size heuristic is the compass.
const DECLARED = "800x480@7";
const PANEL = { widthPx: 640, heightPx: 384 };

function plan(homeMode: "full" | "compass" | undefined, dialTargetKey: string | null) {
  const settings = parseDisplayProfileSettings(
    homeMode === undefined ? {} : { byTarget: { [DECLARED]: { homeMode } } }
  );
  return buildPresentationPlan({
    viewport: PANEL,
    profileSettings: settings,
    deviceKindSetting: "auto",
    diagonalInches: 7,
    dialTargetKey
  });
}

test("the measured key of that panel is not the declared key, and its heuristic is the compass", () => {
  const p = plan(undefined, null);
  assert.notEqual(p.targetKey, DECLARED, "the panel's measured key drifted from the declared one");
  assert.equal(p.interaction, "pivot", "with nothing applied the size heuristic gives the compass");
});

test("Full layout applied under the declared key is what the panel shows", () => {
  const p = plan("full", DECLARED);
  assert.equal(p.interaction, "standard", "the applied Full layout lands on the panel");
});

test("Compass stays available when Compass is the selected home", () => {
  const p = plan("compass", DECLARED);
  assert.equal(p.interaction, "pivot");
});

test("without a declared key the home style still resolves off the measured key", () => {
  // Designer preview and remote sessions pass no declared key; there the
  // two keys are the same and the behaviour is unchanged.
  const settings = parseDisplayProfileSettings({ byTarget: { "640x384@7": { homeMode: "full" } } });
  const p = buildPresentationPlan({
    viewport: PANEL,
    profileSettings: settings,
    deviceKindSetting: "auto",
    diagonalInches: 7,
    dialTargetKey: null
  });
  assert.equal(p.targetKey, "640x384@7");
  assert.equal(p.interaction, "standard");
});

test("the plan resolves the home style off the dial key, never the measured key alone", () => {
  assert.ok(/resolveHomeMode\(dialKey, input\.profileSettings\)/.test(target), "home style reads the declared key");
  assert.ok(!/resolveHomeMode\(targetKey, input\.profileSettings\)/.test(target), "no measured-key read remains");
});
