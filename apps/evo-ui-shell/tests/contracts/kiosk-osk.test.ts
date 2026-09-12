// Contract: the Input toggles (on-screen keyboard + mouse pointer) seed from
// the device read and never invent a value; a refused write does not leave a
// sticky lie.
//
// osk_enabled / cursor_visible are each boolean | null. Null means the key is
// absent (a player on the old verb) - the panel disables that row rather than
// defaulting to On. The mouse-pointer write (set_cursor) applies at kiosk
// session start, but its seed/revert rules are identical to the keyboard's.

import test from "node:test";
import assert from "node:assert/strict";
import {
  readOskEnabled,
  readCursorVisible,
  readDerivedCalibration,
  toggleAfterWrite,
  classifyKioskWrite
} from "../../src/features/kiosk/osk-state.ts";

test("readOskEnabled: present true/false seeds that boolean", () => {
  assert.equal(readOskEnabled({ osk_enabled: true }), true);
  assert.equal(readOskEnabled({ osk_enabled: false }), false);
});

test("readOskEnabled: absent key is null (old verb) - never invents On", () => {
  assert.equal(readOskEnabled({}), null);
  assert.equal(readOskEnabled({ enabled: true }), null);
});

test("readOskEnabled: a non-boolean value is null, not coerced", () => {
  assert.equal(readOskEnabled({ osk_enabled: "true" }), null);
  assert.equal(readOskEnabled({ osk_enabled: 1 }), null);
  assert.equal(readOskEnabled({ osk_enabled: null }), null);
});

test("readCursorVisible: present true/false seeds that boolean", () => {
  assert.equal(readCursorVisible({ cursor_visible: true }), true);
  assert.equal(readCursorVisible({ cursor_visible: false }), false);
});

test("readCursorVisible: absent key is null (old verb) - never invents On", () => {
  assert.equal(readCursorVisible({}), null);
  assert.equal(readCursorVisible({ osk_enabled: true }), null);
});

test("readCursorVisible: a non-boolean value is null, not coerced", () => {
  assert.equal(readCursorVisible({ cursor_visible: "true" }), null);
  assert.equal(readCursorVisible({ cursor_visible: 0 }), null);
});

test("toggleAfterWrite: success keeps the attempted value", () => {
  assert.equal(toggleAfterWrite(false, true, true), true);
  assert.equal(toggleAfterWrite(true, false, true), false);
});

test("toggleAfterWrite: a refused write reverts to prev - no sticky lie", () => {
  assert.equal(toggleAfterWrite(false, true, false), false);
  assert.equal(toggleAfterWrite(true, false, false), true);
});

test("classifyKioskWrite: a successful write is ok", () => {
  assert.equal(classifyKioskWrite({ ok: true }), "ok");
  assert.equal(classifyKioskWrite({ ok: true, subclass: "anything" }), "ok");
});

test("classifyKioskWrite: household_policy_locked is locked, not blocked", () => {
  // The lie-fix: a locked write must NOT read as "player-side controls not
  // in place". It routes to the household notice + door instead.
  assert.equal(
    classifyKioskWrite({ ok: false, subclass: "household_policy_locked" }),
    "locked"
  );
});

test("classifyKioskWrite: any other failure is blocked (honest unavailable)", () => {
  assert.equal(classifyKioskWrite({ ok: false }), "blocked");
  assert.equal(
    classifyKioskWrite({ ok: false, subclass: "verb_not_supported" }),
    "blocked"
  );
  assert.equal(
    classifyKioskWrite({ ok: false, subclass: "step_up_required" }),
    "blocked"
  );
});

const WIRE = {
  touch_rotation: "180",
  touch_hflip: true,
  touch_vflip: false,
  mean_error: 0.01
} as const;

test("readDerivedCalibration: the wire triple maps onto the wizard shape", () => {
  assert.deepEqual(readDerivedCalibration({ ...WIRE }), {
    rotation: "180",
    hflip: true,
    vflip: false,
    meanError: 0.01
  });
});

test("readDerivedCalibration: missing, wrong-type, or aliased fields are null", () => {
  assert.equal(readDerivedCalibration(undefined), null);
  assert.equal(readDerivedCalibration({}), null);
  assert.equal(readDerivedCalibration({ ...WIRE, touch_rotation: "45" }), null);
  assert.equal(readDerivedCalibration({ ...WIRE, touch_hflip: "true" }), null);
  assert.equal(readDerivedCalibration({ ...WIRE, mean_error: Number.NaN }), null);
  // The DOM event used rotation/hflip. Those aliases must not invent a triple.
  assert.equal(
    readDerivedCalibration({
      rotation: "180",
      hflip: true,
      vflip: false,
      mean_error: 0.01
    }),
    null
  );
});
