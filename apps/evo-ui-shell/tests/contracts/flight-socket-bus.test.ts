// Contract: the Flight write socket must rotate on the bearer bus.
//
// Field failure: setFlight opened its private socket with
// bearerSource: storedBearer and kept it, but nothing subscribed it to
// the bearer bus. bearerSource is read at the handshake, so an
// already-open Flight socket kept the identity it opened with
// (LAN-trust) after an in-place pair - or a purged bearer after a
// purge - until it happened to drop. The power write socket got the
// bus in the previous row; this is the rest of that on this hook. Now
// the hook's one bus listener re-handshakes both write sockets at
// once: a pair or a purge calls rotateBearer on flightTxRef when it
// exists, and rotateBearer only closes a socket that is open (a
// closed one already re-reads the source on its next open). The
// Flight set payload and outcomes, the seed reads, the power pick and
// the unmount close are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { powerWriteSocket } from "../../src/features/system/power-write-socket.ts";
import { onBearerChange, notifyBearerChange } from "../../src/runtime/bearer.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/system/useSystemPower.ts");
const transport = src("runtime/ws-transport.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const listener = between(hook, "const off = onBearerChange(() => {", "});");
const setFlight = between(hook, "const setFlight = useCallback", "return {\n    available,");
const pick = between(hook, "const writeTransport = useCallback", "// Dispatch a system.power verb");

test("a pair or purge calls rotateBearer on flightTxRef when it is open", () => {
  assert.ok(
    /const flight = flightTxRef\.current;\s*if \(flight !== null\) flight\.rotateBearer\(\);/.test(listener),
    "the bus listener re-handshakes the Flight write socket"
  );
  assert.ok(
    /const tx = powerTxRef\.current;\s*if \(tx !== null\) tx\.rotateBearer\(\);/.test(listener),
    "and still the power write socket - one bus signal, both sockets"
  );
  assert.equal((hook.match(/onBearerChange\(/g) ?? []).length, 1, "one subscription for the hook");
  // "when it is open": rotateBearer only closes an OPEN socket; a
  // socket on its reconnect loop already reads the source next time.
  assert.ok(
    /public rotateBearer\(\): void \{\s*if \(this\.socket !== null && this\.socket\.readyState === WebSocket\.OPEN\) \{\s*this\.socket\.close\(1000, "bearer-rotated"\);/.test(transport)
  );
  // The bus itself: a store or a purge reaches every subscribed listener once.
  let fired = 0;
  const off = onBearerChange(() => {
    fired += 1;
  });
  try {
    notifyBearerChange();
    assert.equal(fired, 1);
  } finally {
    off();
  }
  notifyBearerChange();
  assert.equal(fired, 1, "unsubscribed on cleanup");
  // Unmount still closes the Flight socket where it always did.
  assert.ok(/if \(flightTxRef\.current !== null\) \{\s*void flightTxRef\.current\.close\(\);\s*flightTxRef\.current = null;/.test(hook));
});

test("setFlight's request and outcomes are unchanged", () => {
  assert.ok(/let tx = flightTxRef\.current;\s*if \(tx === null\) \{\s*tx = new WsTransport\(\{\s*url: frameworkWsUrl\(\),/.test(setFlight));
  assert.ok(/bearerSource: storedBearer\s*\}\);\s*flightTxRef\.current = tx;/.test(setFlight));
  assert.ok(/pluginRequest\(tx, NETWORK_SHELF, FLIGHT_SET, \{ enabled \}\)/.test(setFlight), "the same set, the same payload");
  // (The in-page flight-bus announce sits between the two lines since
  // the flight-paint row; the outcome is the same ok on the same
  // condition.)
  assert.ok(/if \(r\.error === undefined\) \{\s*setFlightEnabled\(enabled\);\s*notifyFlightChange\(\);\s*return \{ ok: true \};/.test(setFlight));
  assert.ok(/verbErrorMessage\(r\.error, "Flight mode change was refused\."\)/.test(setFlight));
  assert.ok(/catch \(err\) \{\s*return \{\s*ok: false,\s*message: err instanceof Error \? err\.message : "Not connected to the device\."/.test(setFlight));
  assert.ok(!/rotateBearer|onBearerChange|powerTxRef|writeTransport\(\)/.test(setFlight), "setFlight itself is not where the bus lives");
  assert.ok(/const FLIGHT_SET = "network\.nm\.flight_mode\.set";/.test(hook));
  // The seed reads are still the seed's.
  const seed = between(hook, "const transport = new WsTransport({ url: frameworkWsUrl() });", "void seed();");
  assert.ok(/transport\.dispatch\("list_plugins", \{\}\)/.test(seed) && /pluginRequest\(transport, NETWORK_SHELF, FLIGHT_GET, \{\}\)/.test(seed));
});

test("the power write pick is unchanged", () => {
  assert.equal(powerWriteSocket(true), "stored-bearer");
  assert.equal(powerWriteSocket(false), "seed");
  assert.ok(/if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return transportRef\.current;\s*\}/.test(pick));
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick));
  assert.ok(!/\?\? transportRef\.current|flightTxRef/.test(pick));
  assert.equal((hook.match(/bearerSource/g) ?? []).length, 2, "still two bearer sockets: Flight and power");
});

test("FrameworkTransport is never given a token", () => {
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared));
  assert.ok(!/setBearerToken\(|useFrameworkTransport|tryUseFrameworkTransport|bearerToken/.test(hook));
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if a fourth announcer or a second listener appears anywhere
// under src, if the power hook grows a second bearer listener, or if a
// refused Flight set starts announcing.

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

test("LOCK one flight bus: three announcers, one listener, one bearer listener for the power + flight sockets", () => {
  const srcRoot = join(here, "..", "..", "src");
  const announcers: string[] = [];
  const listeners: string[] = [];
  for (const file of walk(srcRoot)) {
    if (file.endsWith(join("runtime", "flight-bus.ts"))) continue;
    const text = readFileSync(file, "utf8");
    const rel = file.slice(srcRoot.length + 1).split("\\").join("/");
    for (const _ of text.matchAll(/notifyFlightChange\(\)/g)) announcers.push(rel);
    for (const _ of text.matchAll(/onFlightChange\(/g)) listeners.push(rel);
  }
  assert.deepEqual(announcers.sort(), [
    "features/network/useNetworkLink.ts",
    "features/network/useNetworkLink.ts",
    "features/system/useSystemPower.ts"
  ], "flight_mode.set (Network), intent.set (Network), flight_mode.set (power) - and no other");
  assert.deepEqual(listeners, ["features/system/useSystemPower.ts"], "only the power hook re-reads on the bus");
  assert.equal((hook.match(/onBearerChange\(/g) ?? []).length, 1);
  assert.equal((hook.match(/rotateBearer\(\)/g) ?? []).length, 2, "power + flight, one signal");
  // A refused set announces nothing, on both hooks.
  const link = src("features/network/useNetworkLink.ts");
  for (const [name, block] of [
    ["power setFlight", between(setFlight, "return {\n        ok: false,", "};")],
    ["link setFlight", between(between(link, "const setFlight = useCallback", "const joinSsid = useCallback"), "if (!r.ok) {", "}")],
    ["link saveAndApply", between(between(link, "const saveAndApply = useCallback", "const setFlight = useCallback"), "if (!r.ok) {", "}")]
  ] as const) {
    assert.ok(!/notifyFlightChange/.test(block), `${name}: a refused set announces nothing`);
  }
  assert.match(setFlight, /if \(r\.error === undefined\) \{\s*setFlightEnabled\(enabled\);\s*notifyFlightChange\(\);\s*return \{ ok: true \};\s*\}\s*return \{\s*ok: false,/);
});
