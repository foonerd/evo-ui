// Contract: the Network "pair to manage" prompt (authNeeded) clears when
// inline pairing completes. Named defect: .24 minted a paired-device bearer
// but the banner "This device isn't paired for network management" stuck -
// reauth() rebuilt the socket but never cleared the flag. This pins the
// pair -> cleared transition.

import test from "node:test";
import assert from "node:assert/strict";
import { nextAuthNeeded } from "../../src/features/network/network-auth-state.ts";

test("no stored bearer raises the pair prompt", () => {
  assert.equal(nextAuthNeeded({ kind: "no_bearer" }), true);
});

test("a mutation result carries the classifier verdict", () => {
  assert.equal(nextAuthNeeded({ kind: "verb_result", pairRequired: true }), true);
  assert.equal(nextAuthNeeded({ kind: "verb_result", pairRequired: false }), false);
});

test("reauth (pairing complete) clears the prompt - banner never sticks", () => {
  assert.equal(nextAuthNeeded({ kind: "reauth" }), false);
});
