// Contract: an intent.set that writes radio_policy.flight_mode announces
// on the flight bus.
//
// Field failure: joinSsid sends network.nm.intent.set with
// radio_policy.flight_mode: false - the join is the one intent write
// that always clears Flight - and every other saveAndApply carries the
// full intent, radio_policy.flight_mode included. None of them
// announced: only flight_mode.set did. saveAndApply refresh()es
// Network, so its own tile caught up, but every power-cluster instance
// kept aria-pressed on until remount. Now a landed intent.set announces
// once on the same in-page flight bus, after the player accepted it,
// so each power instance re-reads FLIGHT_GET on its seed socket. A
// refused set announces nothing. The intent.set payload and apply:
// true, the flight_mode.set announce, the seed-socket follow and
// Network's quiet poll are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { onFlightChange, notifyFlightChange } from "../../src/runtime/flight-bus.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const link = src("features/network/useNetworkLink.ts");
const power = src("features/system/useSystemPower.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const saveAndApply = between(link, "const saveAndApply = useCallback", "const setFlight = useCallback");
const setFlight = between(link, "const setFlight = useCallback", "const joinSsid = useCallback");
const joinSsid = between(link, "const joinSsid = useCallback", "// Forget the saved Wi-Fi network");

test("a landed intent.set announces once on the flight bus, after the player accepted it", () => {
  assert.ok(
    /if \(!r\.ok\) \{\s*setError\(r\.message\);\s*return false;\s*\}\s*setIntent\(next\);(\s*\/\/[^\n]*)*\s*notifyFlightChange\(\);/.test(saveAndApply),
    "announced after the landed set, before Network's own re-read"
  );
  assert.equal((saveAndApply.match(/notifyFlightChange\(\)/g) ?? []).length, 1, "once per landed set");
  const refused = between(saveAndApply, "if (!r.ok) {", "}");
  assert.ok(!/notifyFlightChange/.test(refused), "a refused set announces nothing");
  assert.ok(/await refresh\(\);\s*return true;/.test(saveAndApply), "Network still re-reads after its own set");
});

test("the join writes radio_policy.flight_mode false through that one path", () => {
  assert.ok(/radio_policy: \{\s*\.\.\.intent\.radio_policy,\s*flight_mode: false\s*\}/.test(joinSsid), "the join always clears Flight");
  assert.ok(/return saveAndApply\(next, \{ staPsk: open \? undefined : psk \}\);/.test(joinSsid), "through saveAndApply, no second send");
  assert.ok(!/notifyFlightChange|request\(/.test(joinSsid), "the join itself neither sends nor announces");
});

test("the intent.set payload and apply: true are unchanged", () => {
  assert.ok(/const payload: Record<string, unknown> = \{\s*intent: next,\s*apply: true\s*\};/.test(saveAndApply));
  assert.ok(/if \(opts\?\.staPsk !== undefined && opts\.staPsk\.length > 0\) \{\s*payload\.sta_psk = opts\.staPsk;/.test(saveAndApply));
  assert.ok(/if \(opts\?\.apPsk !== undefined && opts\.apPsk\.length > 0\) \{\s*payload\.ap_psk = opts\.apPsk;/.test(saveAndApply));
  assert.ok(/const r = await request\("network\.nm\.intent\.set", payload\);/.test(saveAndApply));
  assert.equal((saveAndApply.match(/await request\(/g) ?? []).length, 1, "one send");
});

test("the flight_mode.set announce, the seed-socket follow and Network's poll are unchanged", () => {
  assert.equal((setFlight.match(/notifyFlightChange\(\)/g) ?? []).length, 1);
  assert.ok(/setFlightMode\(enabled\);(\s*\/\/[^\n]*)*\s*notifyFlightChange\(\);/.test(setFlight));
  assert.ok(!/onFlightChange/.test(link), "the link hook still does not listen");
  assert.ok(/void refresh\(true\);\s*\}, 4000\);/.test(link), "the quiet poll is still the Network follow");
  const follow = between(power, "const off = onFlightChange(() => {", "}, []);");
  assert.ok(/pluginRequest\(transport, NETWORK_SHELF, FLIGHT_GET, \{\}\)/.test(follow) && !/bearerSource|flightTxRef|powerTxRef/.test(follow),
    "each power instance still re-reads on its seed socket");
  assert.equal((power.match(/notifyFlightChange\(\)/g) ?? []).length, 1, "the power set still announces once");
  // Two announcers on the link hook now (flight_mode.set and intent.set), one bus.
  assert.equal((link.match(/notifyFlightChange\(\)/g) ?? []).length, 2);
  // The bus itself still fires each listener once per announce.
  let fired = 0;
  const off = onFlightChange(() => {
    fired += 1;
  });
  try {
    notifyFlightChange();
    assert.equal(fired, 1);
  } finally {
    off();
  }
});
