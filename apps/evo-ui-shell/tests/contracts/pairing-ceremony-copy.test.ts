// Contract: the pairing ceremony chrome (flow title, the submit buttons, and
// the choose-method body) reads in the operator words - authorise this browser
// - NOT "pair"/"pairing", NOT "manage the player", NOT Bluetooth. Copy only:
// PairDeviceFlow's behaviour and screens are unchanged; only these strings move.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const en = readFileSync(
  join(here, "..", "..", "src", "locales", "en.ts"),
  "utf8"
);

function value(key: string): string {
  // \s* spans the key/value line break for the wrapped body entry.
  const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`).exec(en);
  assert.notEqual(m, null, `${key} must exist`);
  return m![1];
}

const KEYS = [
  "pairing.title",
  "pairing.auth.submit",
  "pairing.code.submit",
  "pairing.preseed.submit",
  "pairing.choose.body",
  "pairing.password.notAdmitted"
];

test("ceremony chrome drops 'pair' / 'pairing' / 'manage the player' / Bluetooth", () => {
  for (const k of KEYS) {
    const v = value(k).toLowerCase();
    assert.ok(!v.includes("pair"), `${k} still says pair/pairing: "${v}"`);
    assert.ok(
      !v.includes("manage the player"),
      `${k} still says "manage the player": "${v}"`
    );
    assert.ok(!v.includes("bluetooth"), `${k} must not mention Bluetooth`);
  }
});

test("the ceremony title, submits, and body use the operator word authorise", () => {
  for (const k of KEYS) {
    assert.ok(
      value(k).toLowerCase().includes("authoris"),
      `${k} must use "authorise"`
    );
  }
});
