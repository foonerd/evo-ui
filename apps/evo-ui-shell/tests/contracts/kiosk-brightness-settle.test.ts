// Contract: the Display brightness echo reverts when set_brightness is
// not ok.
//
// Field failure: every other Display / Touch write commits only on an
// accepted settle, but brightness moved the thumb and wrote the cache
// first (the live echo a drag slider needs) and then only classified
// the reply. A household lock or a blocked write left the slider on a
// value the player does not have. The echo while dragging stays; a
// write the player did not take now puts the slider back to the value
// the player holds - the get_display_state seed, or the last accepted
// write.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { brightnessAfterSettle, classifyKioskWrite } from "../../src/features/kiosk/osk-state.ts";

test("a refused brightness write does not leave the echoed value", () => {
  // Seeded at 80 from the player; the operator dragged to 100; refused.
  assert.deepEqual(brightnessAfterSettle("blocked", 100, 80), { show: 80, held: 80 });
  assert.deepEqual(brightnessAfterSettle("locked", 100, 80), { show: 80, held: 80 });
  // The classification still comes from settle's verdict, lock vs blocked.
  assert.equal(classifyKioskWrite({ ok: false, subclass: "household_policy_locked" }), "locked");
  assert.equal(classifyKioskWrite({ ok: false }), "blocked");
});

test("an accepted brightness write becomes the value the player holds", () => {
  assert.deepEqual(brightnessAfterSettle("ok", 100, 80), { show: 100, held: 100 });
  // A later refusal reverts to THAT, not to the seed.
  assert.deepEqual(brightnessAfterSettle("blocked", 40, 100), { show: 100, held: 100 });
});

// ---- the panel --------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(
  join(here, "..", "..", "src", "features", "kiosk", "KioskDisplayPanel.tsx"),
  "utf8"
);

test("the panel echoes live, settles through the verdict, and reverts state and cache on a refusal", () => {
  const apply = panel.slice(panel.indexOf("const applyBrightness ="), panel.indexOf("const applySleep ="));
  assert.ok(/setBrightness\(c\);\s*const seq/.test(apply), "the live echo while dragging stays");
  assert.ok(/const verdict = settle\(res\);/.test(apply), "lock vs blocked still classified through settle");
  assert.ok(/brightnessAfterSettle\(verdict, c, heldBrightness\.current\)/.test(apply));
  assert.ok(/heldBrightness\.current = next\.held;\s*setBrightness\(next\.show\);\s*lsSet\("evo\.kiosk\.brightness", String\(next\.show\)\);/.test(apply),
    "state and cache follow the settled value, never the refused echo");
  assert.ok(!/lsSet\("evo\.kiosk\.brightness", String\(c\)\)/.test(apply), "the cache is not written before the player answers");
  assert.ok(/if \(seq !== brightnessSeq\.current\) return;/.test(apply), "only the latest write of a drag settles the slider");
});

test("the held value is seeded from the player and nothing else in the panel moved", () => {
  assert.ok(/heldBrightness\.current = b;\s*setBrightness\(b\);/.test(panel), "get_display_state seeds the held value");
  // runRemote and the other controls are untouched.
  assert.ok(/void write\(\)\.then\(\(res\) => \{\s*if \(settle\(res\) === "ok"\) commit\(\);\s*\}\);/.test(panel));
  for (const fn of ["pickOrientation", "applyTouch", "applySleep", "applyInhibit", "applyOsk", "applyCursor"]) {
    assert.ok(new RegExp(`const ${fn} = `).test(panel), `${fn} still present`);
  }
});
