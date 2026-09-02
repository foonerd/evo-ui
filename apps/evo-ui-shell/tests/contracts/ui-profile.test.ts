import test from "node:test";
import assert from "node:assert/strict";
import {
  deviceKindFromProfile,
  mergeCustomDisplayProfile,
  mergeTargetDisplayProfile,
  parseDisplayProfileSettings
} from "../../src/runtime/ui-profile.ts";

test("parseDisplayProfileSettings reads byTarget and custom", () => {
  const parsed = parseDisplayProfileSettings({
    byTarget: {
      "800x480@5": { displayFactor: 1.1, deviceKind: "panel" }
    },
    custom: { widthPx: 390, heightPx: 844, deviceKind: "mobile" }
  });
  assert.equal(parsed?.byTarget?.["800x480@5"]?.displayFactor, 1.1);
  assert.equal(parsed?.custom?.deviceKind, "mobile");
});

test("mergeCustomDisplayProfile preserves byTarget", () => {
  const merged = mergeCustomDisplayProfile(
    {
      byTarget: { "800x480@5": { displayFactor: 1.0 } }
    },
    { deviceKind: "tablet", widthPx: 768, heightPx: 1024 }
  );
  assert.equal(merged.byTarget?.["800x480@5"]?.displayFactor, 1.0);
  assert.equal(merged.custom?.deviceKind, "tablet");
  assert.equal(merged.custom?.widthPx, 768);
});

test("mergeTargetDisplayProfile updates one (resolution, size) target", () => {
  const merged = mergeTargetDisplayProfile(null, "640x480@3.5", {
    deviceKind: "panel",
    displayFactor: 1.15
  });
  assert.equal(merged.byTarget?.["640x480@3.5"]?.deviceKind, "panel");
  assert.equal(merged.byTarget?.["640x480@3.5"]?.displayFactor, 1.15);
});

test("deviceKindFromProfile prefers target key over custom", () => {
  const profile = {
    byTarget: { "800x480@5": { deviceKind: "panel" as const } },
    custom: { deviceKind: "mobile" as const }
  };
  assert.equal(deviceKindFromProfile(profile, "800x480@5"), "panel");
  assert.equal(deviceKindFromProfile(profile, null), "mobile");
});
