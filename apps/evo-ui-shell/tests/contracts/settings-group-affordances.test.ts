// Contract tests for the settings-group dedicated-view predicate.
//
// Covers the audit finding that the `onOpenMultiroom` prop was passed
// through SystemSurface but never wired into the rendered output. The
// predicate now drives the affordance render; tests guard that only
// the eligible group(s) render the button, so accidental removal or
// mis-application surfaces immediately.

import test from "node:test";
import assert from "node:assert/strict";
import { settingsGroupDedicatedViewLabel } from "../../src/features/system/settings-group-affordances.ts";

test("settingsGroupDedicatedViewLabel: multi-room is opted in", () => {
  assert.equal(
    settingsGroupDedicatedViewLabel("multi-room"),
    "Open in dedicated view"
  );
});

test("settingsGroupDedicatedViewLabel: every other settings group is not opted in", () => {
  const otherGroups = [
    "library",
    "audio",
    "cast",
    "sources",
    "network",
    "metadata",
    "smart-home",
    "system",
    "activity",
    "about"
  ];
  for (const g of otherGroups) {
    assert.equal(
      settingsGroupDedicatedViewLabel(g),
      null,
      `expected null for group "${g}"`
    );
  }
});

test("settingsGroupDedicatedViewLabel: unknown / typo group ids return null", () => {
  // Guard against silently rendering the button when a stringly-
  // typed group id drifts (refactor, typo, alias).
  assert.equal(settingsGroupDedicatedViewLabel("multiroom"), null);
  assert.equal(settingsGroupDedicatedViewLabel("Multi-Room"), null);
  assert.equal(settingsGroupDedicatedViewLabel(""), null);
});
