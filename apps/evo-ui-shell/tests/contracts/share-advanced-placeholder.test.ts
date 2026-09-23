// Contract: the Add/Edit share advanced field must not offer a CIFS recipe.
//
// Field failure: the one advanced-options input serves CIFS and NFS and
// carried placeholder="vers=3.1.1,noserverino" - a CIFS dialect line. An
// operator adding an NFS share who copied it got a mount that cannot
// work. The field and `advanced_options` on the wire stay; only the
// hint changes, and it names no protocol version for either.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const surface = src("features/sources/SourcesSurface.tsx");
const en = src("locales/en.ts");

test("the advanced placeholder is not vers=3.1.1,noserverino", () => {
  assert.ok(!/vers=3\.1\.1,noserverino/.test(surface));
  assert.ok(!/placeholder="vers=/.test(surface), "no literal vers= recipe on any input");
  assert.ok(/placeholder=\{t\("sources\.form\.advancedHint"\)\}/.test(surface), "the hint is copy, not a recipe");
});

test("the hint names no CIFS or NFS version and is 7-bit", () => {
  const m = /"sources\.form\.advancedHint":\s*"([^"]*)"/.exec(en);
  assert.ok(m !== null, "sources.form.advancedHint exists");
  const hint = m![1];
  assert.ok(!/vers\s*=/.test(hint), "no vers= line");
  assert.ok(!/noserverino|nfsvers|SMB\s*\d|\b[123]\.[01](\.1)?\b/.test(hint), "no dialect or version");
  assert.ok(/^[\x20-\x7E]+$/.test(hint));
});

test("the field and its wire stay: advanced still binds and advanced_options still travels", () => {
  assert.ok(/value=\{advanced\}/.test(surface), "the input still binds the advanced value");
  assert.ok(/setAdvanced\(/.test(surface));
  assert.ok(/advanced_options/.test(surface), "advanced_options still leaves the form");
});
