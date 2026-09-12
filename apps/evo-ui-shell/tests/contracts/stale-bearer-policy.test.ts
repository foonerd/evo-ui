// Named regression: a stale operator bearer must self-recover, not
// dead-end at "file sharing isn't available".
//
// Field failure (a target reinstalled while a browser kept its bearer):
// the browser still held an evoBearer minted by the pre-wipe device. The
// reinstalled steward's key no longer verifies it, so ws_endpoint refused
// the upgrade with 401 and the SMB surface's private bearer socket never
// connected -> perpetual "unavailable". A no-bearer session worked,
// because the anonymous LAN-trust upgrade succeeds. The fix re-probes
// anonymously and, when that read lands, purges the dead token. This
// locks that decision surface.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveConnectFailure,
  resolveProbeRead
} from "../../src/runtime/stale-bearer-policy.ts";

test("connect failure with a stored bearer, first time -> probe anonymously", () => {
  assert.equal(
    resolveConnectFailure({ hadStoredBearer: true, probing: false }),
    "probe"
  );
});

test("connect failure with NO stored bearer -> honest error (nothing to blame)", () => {
  assert.equal(
    resolveConnectFailure({ hadStoredBearer: false, probing: false }),
    "surface-error"
  );
});

test("anon probe's OWN connect also failing -> device is down, surface error (never loop)", () => {
  // probing=true means this attempt was already the anonymous re-probe.
  assert.equal(
    resolveConnectFailure({ hadStoredBearer: true, probing: true }),
    "surface-error"
  );
});

test("anon probe read LANDS -> the token is the culprit, purge it", () => {
  assert.equal(
    resolveProbeRead({ probing: true, readLanded: true }),
    "purge"
  );
});

test("anon probe connected but read REFUSED -> cannot blame token, back out (keep it)", () => {
  assert.equal(
    resolveProbeRead({ probing: true, readLanded: false }),
    "backout"
  );
});

test("not probing -> read handling is ordinary, no bearer decision either way", () => {
  assert.equal(resolveProbeRead({ probing: false, readLanded: true }), "none");
  assert.equal(resolveProbeRead({ probing: false, readLanded: false }), "none");
});

test("NEVER purge a valid bearer on a transient outage: no purge path when not probing", () => {
  // The only route to "purge" requires probing=true AND readLanded=true,
  // i.e. an anonymous read proved the device reachable. A plain outage
  // fails the anon connect (surface-error), so the token is preserved.
  for (const readLanded of [true, false]) {
    assert.notEqual(resolveProbeRead({ probing: false, readLanded }), "purge");
  }
});
