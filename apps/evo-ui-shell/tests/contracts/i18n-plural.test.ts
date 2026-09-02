import test from "node:test";
import assert from "node:assert/strict";

import { tn } from "../../src/runtime/i18n.ts";

// dialog.trackCount.one / .many exist in the en catalog.
test("tn picks the English singular/plural forms and interpolates {n}", () => {
  assert.equal(tn("dialog.trackCount", 1), "1 track");
  assert.equal(tn("dialog.trackCount", 2), "2 tracks"); // en 'other' falls back to .many
  assert.equal(tn("dialog.trackCount", 0), "0 tracks");
  assert.equal(tn("dialog.trackCount", 21), "21 tracks");
});

test("tn on a missing key renders the key + category - visible, never blank", () => {
  assert.equal(tn("nope.missing", 1), "nope.missing.one");
});
