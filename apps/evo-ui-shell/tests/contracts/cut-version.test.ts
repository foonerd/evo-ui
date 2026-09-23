// Contract: cut(V). The cut version V (MAJOR.MINOR.PATCH.CUT) lives in
// VERSION at the repo root and is the slot key the piece publisher uses.
// The three-part npm and crate versions carry the first three components
// of V and never decide the slot; the fourth component is never dropped.
// Run:
//   node --experimental-strip-types --test tests/contracts/cut-version.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
const pkg = JSON.parse(readFileSync(join(root, "apps", "evo-ui-shell", "package.json"), "utf8")) as {
  version: string;
};
const cargo = readFileSync(join(root, "apps", "evo-ui-runtime", "Cargo.toml"), "utf8");
const lock = readFileSync(join(root, "apps", "evo-ui-runtime", "Cargo.lock"), "utf8");
// The piece publisher is a public workflow; the squash preserves the
// public .github/workflows/ and strips the eng one, so this file exists
// on the public side only. Where it exists it must key on VERSION.
const workflowPath = join(root, ".github", "workflows", "publish-pieces.yml");
const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : null;
const script = readFileSync(join(root, "scripts", "release", "set-cut-version.sh"), "utf8");

test("VERSION is a four-component cut version", () => {
  assert.match(version, /^\d+\.\d+\.\d+\.\d+$/, "VERSION carries MAJOR.MINOR.PATCH.CUT");
});

test("the three-part manifests carry the first three components of V, and nothing else", () => {
  const three = version.split(".").slice(0, 3).join(".");
  assert.equal(pkg.version, three, "package.json follows V");
  const crate = cargo.match(/^version = "([^"]*)"/m);
  assert.ok(crate !== null, "Cargo.toml has a version line");
  assert.equal(crate[1], three, "Cargo.toml follows V");
  const entry = lock.match(/name = "evo-ui-runtime"\nversion = "([^"]*)"/);
  assert.ok(entry !== null, "Cargo.lock has the evo-ui-runtime entry");
  assert.equal(entry[1], three, "Cargo.lock follows V");
});

test("the piece publisher keys both slots on VERSION, never on a three-part manifest", (t) => {
  if (workflow === null) {
    t.skip("publish-pieces.yml is a public workflow; pinned on the public side");
    return;
  }
  const reads = workflow.match(/VERSION=\$\(tr -d '\[:space:\]' < VERSION\)/g) ?? [];
  assert.equal(reads.length, 2, "ui-shell and ui-runtime both read VERSION");
  assert.ok(!/VERSION=\$\(awk[^\n]*package\.json\)/.test(workflow), "no slot key from package.json");
  assert.ok(!/VERSION=\$\(awk[^\n]*Cargo\.toml\)/.test(workflow), "no slot key from Cargo.toml");
});

test("cut(V) refuses anything but four components and writes every manifest", () => {
  assert.ok(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/.test(script), "V is validated as four components");
  for (const f of ["VERSION", "apps/evo-ui-shell/package.json", "apps/evo-ui-runtime/Cargo.toml", "apps/evo-ui-runtime/Cargo.lock"]) {
    assert.ok(script.includes(f), "cut(V) writes " + f);
  }
});
