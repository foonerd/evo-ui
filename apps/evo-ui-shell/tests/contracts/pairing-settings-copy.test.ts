// Contract: the Settings pairing row reads as "authorise this browser with the
// player's system password" - NOT "pair"/"pairing", NOT "manage the player",
// NOT Bluetooth. Copy-only row (PairDeviceFlow behaviour is unchanged); the
// keys the row renders must be free of the retired vocabulary, including the
// expiry variant (pairedUntil).
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
  const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`).exec(en);
  assert.notEqual(m, null, `${key} must exist`);
  return m![1];
}

const KEYS = [
  "pairing.settings.label",
  "pairing.settings.pair",
  "pairing.settings.repair",
  "pairing.settings.paired",
  "pairing.settings.pairedUntil",
  "pairing.settings.notPaired"
];

test("the pairing row keys drop 'pair' / 'pairing' / 'manage the player' / Bluetooth", () => {
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

test("the pairing row keys use the operator words: authorise + system password", () => {
  assert.ok(
    value("pairing.settings.label").toLowerCase().includes("authoris"),
    "label must authorise this browser"
  );
  assert.ok(
    value("pairing.settings.notPaired")
      .toLowerCase()
      .includes("system password"),
    "notPaired must name the player's system password"
  );
});
