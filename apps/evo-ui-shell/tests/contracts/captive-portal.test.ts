// Captive-portal form: proves the UI parses the device's captive.status
// form descriptor and builds the correct submit map, on a canned fixture
// (no captive AP needed). Run:
//   node --experimental-strip-types --test tests/contracts/captive-portal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCaptiveStatus,
  collectCaptiveValues
} from "../../src/features/network/network-nm-decoders.ts";

// A realistic hotel portal as the device would report it on captive.status.
const WIRE = {
  captive: {
    captive: true,
    phase: "awaiting_credentials",
    user_portal_url: "http://portal.hotel.example/login",
    form: {
      action: "http://portal.hotel.example/auth",
      method: "post",
      fields: [
        { name: "guest_name", type: "text", label: "Guest name", required: true },
        { name: "room", type: "text", label: "Room number", required: true },
        { name: "voucher", type: "text", label: "Voucher" },
        {
          name: "agree",
          type: "checkbox",
          label: "Agree to terms",
          required: true,
          value: "yes"
        },
        { name: "plan", type: "select", label: "Plan", options: ["Free", "Premium"] },
        { name: "csrf", type: "hidden", value: "tok-123" },
        { name: "submit", type: "submit", label: "Login" }
      ]
    },
    requires_interactive: false,
    requires_user_confirmation: false,
    actions: [
      { id: "network.nm.captive.confirm_replay", label: "Confirm replay" }
    ],
    seconds_remaining: 3600,
    last_error: null
  }
};

test("decode: captive state + portal url from user_portal_url", () => {
  const c = decodeCaptiveStatus(WIRE);
  assert.ok(c);
  assert.equal(c.captive, true);
  assert.equal(c.phase, "awaiting_credentials");
  assert.equal(c.portalUrl, "http://portal.hotel.example/login");
  assert.equal(c.requiresInteractive, false);
  assert.equal(c.secondsRemaining, 3600);
});

test("decode: form parsed, hidden + submit stripped, method upper-cased", () => {
  const c = decodeCaptiveStatus(WIRE);
  assert.ok(c?.form);
  assert.equal(c.form.action, "http://portal.hotel.example/auth");
  assert.equal(c.form.method, "POST");
  // 7 raw fields -> 5 rendered (hidden + submit removed)
  const names = c.form.fields.map((f) => f.name);
  assert.deepEqual(names, ["guest_name", "room", "voucher", "agree", "plan"]);
  const agree = c.form.fields.find((f) => f.name === "agree");
  assert.equal(agree?.type, "checkbox");
  assert.equal(agree?.required, true);
  const plan = c.form.fields.find((f) => f.name === "plan");
  assert.deepEqual(plan?.options, ["Free", "Premium"]);
});

test("decode: actions + interactive flag", () => {
  const c = decodeCaptiveStatus(WIRE);
  assert.equal(c?.actions.length, 1);
  assert.equal(c?.actions[0].id, "network.nm.captive.confirm_replay");
  const inter = decodeCaptiveStatus({
    captive: { captive: true, phase: "probe_detected", requires_interactive: true }
  });
  assert.equal(inter?.requiresInteractive, true);
  assert.equal(inter?.form, null);
});

test("collect: operator values + defaults, empties dropped, no hidden fields", () => {
  const c = decodeCaptiveStatus(WIRE);
  assert.ok(c?.form);
  // Operator fills name/room/agree; leaves voucher/plan blank.
  const vals = { guest_name: "Ada", room: "214", agree: "yes", voucher: "" };
  const out = collectCaptiveValues(c.form, vals);
  assert.deepEqual(out, { guest_name: "Ada", room: "214", agree: "yes" });
  // csrf (hidden) is never in the UI form and never submitted from here.
  assert.equal("csrf" in out, false);
  // blank voucher dropped so the portal sees absence.
  assert.equal("voucher" in out, false);
});

test("collect: unchecked required checkbox is omitted (portal sees absence)", () => {
  const c = decodeCaptiveStatus(WIRE);
  const out = collectCaptiveValues(c!.form, { guest_name: "Ada", agree: "" });
  assert.equal("agree" in out, false);
  assert.equal(out.guest_name, "Ada");
});
