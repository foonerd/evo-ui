// Contract: the leftover "pair to manage" banners (Network / Sources / SMB /
// USB) read in the SAME operator words as the System pairing row - authorise
// this browser, the player's system password - NOT "pair"/"pairing", NOT
// "manage the player", NOT Bluetooth. Copy only: when each banner shows is
// unchanged (the components are untouched), and PairDeviceFlow is unchanged.
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
  // \s* spans the key/value line break for the wrapped entries.
  const m = new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`).exec(en);
  assert.notEqual(m, null, `${key} must exist`);
  return m![1];
}

const KEYS = [
  "settings.network.authNeeded",
  "settings.network.pairToManage",
  "sources.authNeeded",
  "sources.pairToManage",
  "sources.needsResponder",
  "smb.authNeeded",
  "usb.pairNotice",
  "usb.pairAction"
];

test("the pair-to-manage banners drop 'pair' / 'pairing' / 'manage the player' / Bluetooth", () => {
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

test("the banners use the operator words: authorise (+ system password on the notices)", () => {
  for (const k of KEYS) {
    assert.ok(
      value(k).toLowerCase().includes("authoris"),
      `${k} must use "authorise"`
    );
  }
  assert.ok(
    value("settings.network.authNeeded").toLowerCase().includes("system password"),
    "the network notice must name the system password"
  );
  assert.ok(
    value("sources.authNeeded").toLowerCase().includes("system password"),
    "the sources notice must name the system password"
  );
});
