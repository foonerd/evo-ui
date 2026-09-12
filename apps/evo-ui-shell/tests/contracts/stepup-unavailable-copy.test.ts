// Contract: stepup.unavailable no longer tells the operator to "re-pair this
// device" - it uses the operator words (authorise this browser). Copy only;
// step-up behaviour (StepUpHost, the verify handshake, when the card shows) is
// unchanged.
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

test("stepup.unavailable drops 'pair'/'pairing' and uses authorise", () => {
  const v = value("stepup.unavailable").toLowerCase();
  assert.ok(!v.includes("pair"), `still says re-pair/pairing: "${v}"`);
  assert.ok(v.includes("authoris"), "must use the operator word authorise");
});
