// Contract: Settings -> Network never paints "Checking" forever. An empty
// device table is "Checking" only inside a short grace (the same 8s File
// sharing uses); past it, the tiles say so honestly, or show the existing
// Pair CTA when the classifier said pair. When nm.status answers, the tiles
// paint real state again. Reads stay on the shared page socket; the quiet
// poll is untouched; apply / scan / country writes are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  NETWORK_STATUS_GRACE_MS,
  statusPaint
} from "../../src/features/network/network-status-bound.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const landing = readFileSync(join(root, "features", "network", "NetworkLanding.tsx"), "utf8");
const link = readFileSync(join(root, "features", "network", "useNetworkLink.ts"), "utf8");
const smb = readFileSync(join(root, "features", "sources", "SmbServerSurface.tsx"), "utf8");

test("the grace bound matches File sharing's", () => {
  assert.equal(NETWORK_STATUS_GRACE_MS, 8000);
  assert.ok(/setTimeout\(\(\) => setTimedOut\(true\), 8000\)/.test(smb), "File sharing still uses 8s");
});

test("a loaded table paints real state regardless of the timer", () => {
  assert.equal(statusPaint({ loaded: true, timedOut: false, pair: false }), "loaded");
  assert.equal(statusPaint({ loaded: true, timedOut: true, pair: true }), "loaded");
});

test("an empty table is Checking only inside the grace", () => {
  assert.equal(statusPaint({ loaded: false, timedOut: false, pair: false }), "checking");
});

test("past the grace, empty is an honest error - or the Pair CTA when the classifier said pair", () => {
  assert.equal(statusPaint({ loaded: false, timedOut: true, pair: false }), "error");
  assert.equal(statusPaint({ loaded: false, timedOut: true, pair: true }), "pair");
});

test("NetworkLanding uses the bound and stops saying Checking past it", () => {
  assert.ok(/NETWORK_STATUS_GRACE_MS/.test(landing), "the landing must arm the shared grace");
  assert.ok(/statusPaint\(/.test(landing), "the paint decision must go through statusPaint");
  assert.ok(
    /settings\.network\.statusUnavailable/.test(landing),
    "an honest status notice must exist for the timed-out empty table"
  );
});

test("useNetworkLink surfaces a failed nm.status instead of dropping it", () => {
  // The read result must be classified: pair -> the existing Pair CTA;
  // household lock -> never painted as link.error; anything else -> honest error.
  assert.ok(
    /if \(statusR\.ok\) setDeviceTable\(decodeDeviceTable\(statusR\.value\)\);\s*else/.test(link),
    "a failed nm.status read must have an else branch"
  );
  assert.ok(/statusR\.authNeeded/.test(link), "a pair-classed status refusal raises the Pair CTA");
  assert.ok(/statusR\.householdLocked/.test(link), "a household-locked status read is not an error paint");
});

test("neighbours stay put: reads on the shared socket, quiet poll unchanged", () => {
  assert.ok(/const tr = sharedTransport \?\? transport;/.test(link), "reads stay on the shared page socket");
  assert.ok(/}, 4000\);/.test(link), "the quiet 4s poll is untouched");
});
