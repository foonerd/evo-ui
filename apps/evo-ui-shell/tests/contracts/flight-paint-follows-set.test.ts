// Contract: the power-cluster Flight paint is not a one-shot seed.
//
// Field failure: useSystemPower ran FLIGHT_GET once at mount and then
// updated flightEnabled only from its own setFlight. The sidebar, the
// pivot and Settings > System each mount their own instance; Settings >
// Network's link hook holds a second copy. The framework publishes no
// Flight happening and no subject, so a set from anywhere else left a
// power-cluster toggle showing the old radio state until remount. Now
// every landed Flight set announces once on one in-page flight bus;
// each power-cluster instance answers a signal by re-reading the flag
// from the player on its own anonymous seed socket - the announced
// value is never the truth, the player's answer is. Network's link
// hook keeps its quiet poll as its follow. No Framework happening is
// invented; the Flight set payload and outcomes, the power write pick,
// the two bearer sockets and FrameworkTransport are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { onFlightChange, notifyFlightChange } from "../../src/runtime/flight-bus.ts";
import { powerWriteSocket } from "../../src/features/system/power-write-socket.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const power = src("features/system/useSystemPower.ts");
const link = src("features/network/useNetworkLink.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const seedEffect = between(power, "const transport = new WsTransport({ url: frameworkWsUrl() });", "void seed();");
const follow = between(power, "const off = onFlightChange(() => {", "}, []);");
const powerSetFlight = between(power, "const setFlight = useCallback", "return {\n    available,");
const linkSetFlight = between(link, "const setFlight = useCallback", "const joinSsid = useCallback");
const pick = between(power, "const writeTransport = useCallback", "// Dispatch a system.power verb");

test("the flight bus is one in-page signal: fires each listener once per set, no payload", () => {
  let fired = 0;
  const off = onFlightChange(() => {
    fired += 1;
  });
  try {
    notifyFlightChange();
    assert.equal(fired, 1);
    notifyFlightChange();
    assert.equal(fired, 2);
  } finally {
    off();
  }
  notifyFlightChange();
  assert.equal(fired, 2, "unsubscribed on cleanup");
  assert.equal(notifyFlightChange.length, 0, "no payload - the player's answer is the truth");
});

test("a Flight set from Network announces on the bus after it lands", () => {
  assert.ok(/import \{ notifyFlightChange \} from "\.\.\/\.\.\/runtime\/flight-bus";/.test(link));
  assert.ok(/setFlightMode\(enabled\);(\s*\/\/[^\n]*)*\s*notifyFlightChange\(\);/.test(linkSetFlight), "announced after the landed set");
  assert.equal((linkSetFlight.match(/notifyFlightChange\(\)/g) ?? []).length, 1, "once, and not on the refused path");
  const refused = between(linkSetFlight, "if (!r.ok) {", "}");
  assert.ok(!/notifyFlightChange/.test(refused), "a refused set announces nothing");
  // Network follows a set made elsewhere on its quiet poll - no second
  // refresh path, no listener of its own.
  assert.ok(!/onFlightChange/.test(link), "the link hook does not listen; its poll is its follow");
  assert.ok(/void refresh\(true\);\s*\}, 4000\);/.test(link), "the quiet poll is still there");
});

test("useSystemPower re-reads FLIGHT_GET from the player on the seed socket when the bus fires", () => {
  assert.ok(/import \{ onFlightChange, notifyFlightChange \} from "\.\.\/\.\.\/runtime\/flight-bus";/.test(power));
  assert.ok(/const transport = transportRef\.current;\s*if \(transport === null\) return;/.test(follow), "the seed socket, or nothing");
  assert.ok(/pluginRequest\(transport, NETWORK_SHELF, FLIGHT_GET, \{\}\)/.test(follow), "the same anonymous read as the seed");
  assert.ok(/const on = decodeFlightEnabled\(fl\.value\);\s*if \(on !== null\) \{\s*setFlightAvailable\(true\);\s*setFlightEnabled\(on\);/.test(follow),
    "the player's answer paints the flag");
  assert.ok(!/writeTransport\(\)|flightTxRef|powerTxRef|bearerSource/.test(follow), "never on a bearer socket");
  assert.ok(/if \(cancelled/.test(follow) && /cancelled = true;\s*off\(\);/.test(power), "cancelled on unmount, listener released");
  assert.ok(/catch \{/.test(follow), "a read that could not go out leaves the paint as it was - never a throw");
  // The seed read itself is untouched.
  assert.ok(/transport\.dispatch\("list_plugins", \{\}\)/.test(seedEffect));
  assert.ok(/const fl = await pluginRequest\(transport, NETWORK_SHELF, FLIGHT_GET, \{\}\);\s*if \(!cancelled && fl\.error === undefined\) \{/.test(seedEffect));
  assert.ok(!/onFlightChange|notifyFlightChange/.test(seedEffect), "the seed is not the follow");
  assert.equal((power.match(/onFlightChange\(/g) ?? []).length, 1, "one subscription per instance");
});

test("useSystemPower's own set announces after it lands; payload and outcomes are unchanged", () => {
  assert.ok(/if \(r\.error === undefined\) \{\s*setFlightEnabled\(enabled\);\s*notifyFlightChange\(\);\s*return \{ ok: true \};/.test(powerSetFlight),
    "announced after the landed set, before the ok");
  assert.equal((powerSetFlight.match(/notifyFlightChange\(\)/g) ?? []).length, 1, "once, and not on the refused path");
  assert.ok(/pluginRequest\(tx, NETWORK_SHELF, FLIGHT_SET, \{ enabled \}\)/.test(powerSetFlight), "the same set, the same payload");
  assert.ok(/verbErrorMessage\(r\.error, "Flight mode change was refused\."\)/.test(powerSetFlight));
  assert.ok(/catch \(err\) \{\s*return \{\s*ok: false,\s*message: err instanceof Error \? err\.message : "Not connected to the device\."/.test(powerSetFlight));
  assert.ok(/let tx = flightTxRef\.current;\s*if \(tx === null\) \{\s*tx = new WsTransport\(\{\s*url: frameworkWsUrl\(\),/.test(powerSetFlight));
  assert.ok(!/onFlightChange|FLIGHT_GET/.test(powerSetFlight), "the set does not read; the follow does");
});

test("no Framework Flight happening is invented; no merge onto the power socket", () => {
  assert.ok(!/flight_mode\.changed|flight_changed|subscribe_happenings|onHappening/.test(power), "no happening, no subject");
  const verbs = [...power.matchAll(/"network\.nm\.[a-z_.]+"/g)].map((m) => m[0]).sort();
  assert.deepEqual([...new Set(verbs)], ['"network.nm.flight_mode.get"', '"network.nm.flight_mode.set"'], "the same two Flight verbs, no new one");
  const bus = src("runtime/flight-bus.ts");
  assert.ok(!/WsTransport|dispatch|pluginRequest|subscribe/.test(bus), "the bus is in-page only");
  assert.equal(powerWriteSocket(true), "stored-bearer");
  assert.ok(/if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return transportRef\.current;\s*\}/.test(pick));
  assert.ok(!/flightTxRef/.test(pick), "Flight stays off the power socket");
  assert.equal((power.match(/bearerSource/g) ?? []).length, 2, "still two bearer sockets");
  const listener = between(power, "const off = onBearerChange(() => {", "});");
  assert.ok(/flight\.rotateBearer\(\)/.test(listener) && /tx\.rotateBearer\(\)/.test(listener), "the bearer bus rotate is untouched");
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared), "FrameworkTransport is never given a token");
});
