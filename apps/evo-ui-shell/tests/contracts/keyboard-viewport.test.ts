// Contract: focused input stays visible above the on-screen keyboard.
//
// Balbuze: Sources > Edit share > Advanced (vers=3.0) sat behind the OSK,
// untypable. The guard publishes the keyboard inset and scrolls the
// focused field into the visible band. These pin the pure geometry: a
// field covered by a fake keyboard inset must end up inside the visible
// viewport; with no keyboard the form is untouched.

import test from "node:test";
import assert from "node:assert/strict";
import {
  keyboardInset,
  revealScrollDelta
} from "../../src/runtime/keyboard-viewport.ts";

test("keyboardInset: no keyboard -> 0", () => {
  assert.equal(keyboardInset(800, 800, 0), 0);
});

test("keyboardInset: OSK shrinks the viewport -> inset px", () => {
  assert.equal(keyboardInset(800, 500, 0), 300);
});

test("keyboardInset: sub-threshold jitter is not a keyboard -> 0", () => {
  assert.equal(keyboardInset(800, 760, 0), 0); // 40px < 80 threshold
});

test("keyboardInset: a shifted visual viewport (offsetTop) is counted", () => {
  assert.equal(keyboardInset(800, 500, 100), 200);
});

test("revealScrollDelta: a field the keyboard covers scrolls into view", () => {
  // Visible band [0,500]; the keyboard covers 500..800. Field at [600,720].
  const delta = revealScrollDelta(600, 720, 0, 500);
  assert.ok(delta > 0, "must scroll down to reveal the field");
  // After scrolling by delta the field's bottom is inside the visible band.
  assert.ok(720 - delta <= 500, "field ends up inside the visible viewport");
});

test("revealScrollDelta: no keyboard leaves the form unchanged", () => {
  // Full viewport [0,800]; the same field is already visible.
  assert.equal(revealScrollDelta(600, 720, 0, 800), 0);
});

test("revealScrollDelta: a field above the visible band scrolls up", () => {
  const delta = revealScrollDelta(-20, 40, 0, 500);
  assert.ok(delta < 0, "must scroll up to reveal the field");
});
