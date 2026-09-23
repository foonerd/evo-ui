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

// ---- reconnect: the same table, after the first seed ------------------
//
// The policy used to run on the FIRST seed only. A bearer that died
// while the socket was open (24h expiry, a re-provisioned player) left
// the transport retrying the construction token forever and the surface
// painted "connected" on its last seed. The reconnect episode composes
// the same table; nothing below can purge without a landed anonymous
// read.

import {
  handshakeBearer,
  handshakeProtocols,
  resolveReconnectEpisode,
  shouldClaimResponder,
  socketPaint
} from "../../src/runtime/bearer-handshake.ts";

test("Reconnect with stored bearer + anon read lands -> purge, anonymous retry, surface live", () => {
  const outcome = resolveReconnectEpisode({
    hadStoredBearer: true,
    anonConnected: true,
    anonReadLanded: true
  });
  assert.equal(outcome, "purge-and-retry-anonymous");
  // After the purge the source reads no bearer: the next handshake is
  // anonymous (LAN-trust reads keep the surface live).
  assert.equal(handshakeProtocols(handshakeBearer(() => undefined, "dead")), undefined);
  assert.equal(socketPaint({ socketOpen: true, episode: outcome }), "connected");
});

test("Reconnect with stored bearer + anon connect fails -> token kept, not connected", () => {
  const outcome = resolveReconnectEpisode({
    hadStoredBearer: true,
    anonConnected: false,
    anonReadLanded: false
  });
  assert.equal(outcome, "keep-token-not-connected");
  // The token is still what the next handshake presents (device down is
  // not a reason to forget a valid pair) and the paint is honest.
  assert.deepEqual(handshakeProtocols(handshakeBearer(() => "kept", undefined)), [
    "evo.bearer.kept"
  ]);
  assert.equal(socketPaint({ socketOpen: false, episode: outcome }), "disconnected");
});

test("Reconnect with stored bearer + anon read refused -> back out, keep the token, honest error", () => {
  const outcome = resolveReconnectEpisode({
    hadStoredBearer: true,
    anonConnected: true,
    anonReadLanded: false
  });
  assert.equal(outcome, "backout-keep-token");
  assert.equal(socketPaint({ socketOpen: false, episode: outcome }), "error");
});

test("Reconnect with NO bearer is an ordinary outage: no bearer decision", () => {
  assert.equal(
    resolveReconnectEpisode({ hadStoredBearer: false, anonConnected: true, anonReadLanded: true }),
    "no-bearer"
  );
});

test("NEVER purge on outage holds across the reconnect episode too", () => {
  for (const anonReadLanded of [true, false]) {
    assert.notEqual(
      resolveReconnectEpisode({ hadStoredBearer: true, anonConnected: false, anonReadLanded }),
      "purge-and-retry-anonymous"
    );
  }
});

test("`connected` is painted only for an OPEN socket", () => {
  assert.equal(socketPaint({ socketOpen: false, episode: null }), "disconnected");
  assert.equal(socketPaint({ socketOpen: true, episode: null }), "connected");
});

test("the handshake reads the live source, never the construction snapshot", () => {
  let current: string | undefined = "first";
  const source = () => current;
  assert.equal(handshakeBearer(source, "snapshot"), "first");
  current = "reminted";
  assert.equal(handshakeBearer(source, "snapshot"), "reminted");
  current = undefined;
  assert.equal(handshakeBearer(source, "snapshot"), undefined);
  // No source: the snapshot is the handshake (fixed-token sockets).
  assert.equal(handshakeBearer(undefined, "snapshot"), "snapshot");
  assert.equal(handshakeBearer(undefined, ""), undefined);
});

test("the responder seat is never claimed without a bearer (LAN-trust cannot hold it)", () => {
  assert.equal(shouldClaimResponder(undefined), false);
  assert.equal(shouldClaimResponder(""), false);
  assert.equal(shouldClaimResponder("paired-or-kiosk"), true);
});
