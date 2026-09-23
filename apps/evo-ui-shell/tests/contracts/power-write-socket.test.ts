// Contract: reboot / power-off must ride the stored bearer when one
// exists.
//
// Field failure: useSystemPower's Flight write already opened a private
// socket presenting the stored bearer, but reboot_device /
// power_off_device went out through dispatchVerb on the hook's
// anonymous seed socket. Both verbs are step_up:system_admin. After an
// in-place pair the sitting is bound to bearer:<id>; a power verb on
// the LAN-trust seed socket presented that sitting from another
// identity, the framework refused it (WrongPeer -> step_up_required),
// and the card came up again for a password that could never satisfy.
// The two verbs now ride a lazy private socket presenting the stored
// bearer (read at every handshake, rotated by the bearer bus, closed
// on unmount, fail closed with no WebSocket); with no bearer they stay
// on the seed socket; list_plugins and the flight read stay on the
// seed socket; setFlight and its own socket are untouched;
// FrameworkTransport is never given a token; classifyPowerVerbOutcome
// stays the classifier and a socket that cannot open is an honest
// error outcome.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { powerWriteSocket } from "../../src/features/system/power-write-socket.ts";
import { classifyPowerVerbOutcome } from "../../src/features/audio/audio-options-decoders.ts";
import { metadataWriteSocket } from "../../src/features/system/metadata-write-socket.ts";
import { audioWriteSocket } from "../../src/features/audio/audio-write-socket.ts";
import { kioskWriteSocket } from "../../src/features/kiosk/osk-state.ts";
import { providerWriteFeedback } from "../../src/features/providers/provider-write-feedback.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/system/useSystemPower.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const PICK_RE =
  /if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return transportRef\.current;\s*\}/;
const WRITE_SOCKET_RE = /new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/;
const SEED_SOCKET_RE = /const transport = new WsTransport\(\{ url: frameworkWsUrl\(\) \}\);/;

const seedEffect = between(hook, "const transport = new WsTransport({ url: frameworkWsUrl() });", "void seed();");
const pick = between(hook, "const writeTransport = useCallback", "// Dispatch a system.power verb");
const dispatchVerb = between(hook, "const dispatchVerb = useCallback", "const reboot = useCallback");
const setFlight = between(hook, "const setFlight = useCallback", "return {\n    available,");

test("with a stored bearer, reboot_device / power_off_device are not sent on the seed socket", () => {
  assert.equal(powerWriteSocket(true), "stored-bearer");
  assert.ok(PICK_RE.test(pick), "only the no-bearer case returns the seed socket");
  assert.ok(WRITE_SOCKET_RE.test(pick), "the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? transportRef\.current/.test(pick), "with a bearer the pick never falls back to the seed socket");
  assert.ok(/powerTxRef\.current = tx;/.test(pick), "the power write socket is its own, not the Flight socket");
  assert.ok(!/flightTxRef/.test(pick), "reboot / power-off do not ride the Flight write socket");
  assert.ok(/const transport = writeTransport\(\);/.test(dispatchVerb), "the verb picks its socket");
  assert.ok(!/transportRef\.current/.test(dispatchVerb), "the verb never names the seed socket");
  assert.ok(
    /transport\.dispatch\("request", \{\s*shelf: POWER_SHELF,\s*request_type: requestType,\s*payload_b64: ""\s*\}\)/.test(dispatchVerb),
    "the same request frame as before, on the chosen socket"
  );
  assert.ok(/\(\) => dispatchVerb\("reboot_device"\)/.test(hook) && /\(\) => dispatchVerb\("power_off_device"\)/.test(hook),
    "both verbs still go through dispatchVerb");
});

test("with no bearer, reboot_device / power_off_device still ride the seed socket", () => {
  assert.equal(powerWriteSocket(false), "seed");
  assert.ok(PICK_RE.test(pick));
  assert.equal((pick.match(/new WsTransport\(/g) ?? []).length, 1, "one constructor in the pick, the bearer one");
});

test("list_plugins and FLIGHT_GET stay on the seed socket", () => {
  assert.ok(SEED_SOCKET_RE.test(hook), "the seed socket is still anonymous");
  assert.ok(/transport\.dispatch\("list_plugins", \{\}\)/.test(seedEffect), "list_plugins on the seed socket");
  assert.ok(/pluginRequest\(transport, NETWORK_SHELF, FLIGHT_GET, \{\}\)/.test(seedEffect), "the flight read on the seed socket");
  assert.ok(!/writeTransport\(\)|powerTxRef|flightTxRef\.current = /.test(seedEffect), "the seed reads never use a write socket");
  assert.ok(!/bearerToken/.test(hook), "no pinned token");
  assert.equal((hook.match(/bearerSource/g) ?? []).length, 2, "bearerSource appears twice: the Flight socket and the power socket");
});

test("setFlight is unchanged", () => {
  assert.ok(/let tx = flightTxRef\.current;\s*if \(tx === null\) \{\s*tx = new WsTransport\(\{\s*url: frameworkWsUrl\(\),/.test(setFlight),
    "the Flight write socket is built as before");
  assert.ok(/bearerSource: storedBearer\s*\}\);\s*flightTxRef\.current = tx;/.test(setFlight));
  assert.ok(/pluginRequest\(tx, NETWORK_SHELF, FLIGHT_SET, \{ enabled \}\)/.test(setFlight), "the same set on its own socket");
  // (The in-page flight-bus announce sits between the two lines since
  // the flight-paint row; the outcome is the same ok on the same
  // condition.)
  assert.ok(/if \(r\.error === undefined\) \{\s*setFlightEnabled\(enabled\);\s*notifyFlightChange\(\);\s*return \{ ok: true \};/.test(setFlight));
  assert.ok(/verbErrorMessage\(r\.error, "Flight mode change was refused\."\)/.test(setFlight));
  assert.ok(!/powerTxRef|writeTransport\(\)|powerWriteSocket/.test(setFlight), "the Flight write does not touch the power pick");
  assert.ok(/if \(flightTxRef\.current !== null\) \{\s*void flightTxRef\.current\.close\(\);\s*flightTxRef\.current = null;/.test(hook),
    "the Flight socket is still closed on unmount where it was");
});

test("FrameworkTransport is never given a token", () => {
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared));
  assert.ok(!/setBearerToken\(|useFrameworkTransport|tryUseFrameworkTransport/.test(hook), "the hook reaches no shared socket and pins no token");
});

test("classifyPowerVerbOutcome stays the classifier; a socket that cannot open is an honest error outcome", () => {
  assert.ok(/return classifyPowerVerbOutcome\(result\.error\);/.test(dispatchVerb));
  assert.ok(
    /catch \(err\) \{[\s\S]*?kind: "error",\s*message: err instanceof Error \? err\.message : String\(err\)/.test(dispatchVerb),
    "a write socket that could not open is an error outcome, never a throw"
  );
  assert.ok(/if \(transport === null\) \{\s*return \{ kind: "error", message: "Not connected to the device\." \};/.test(dispatchVerb));
  // The classifier itself: a drop after the verb is still the fire-and-shutdown success.
  assert.deepEqual(classifyPowerVerbOutcome(undefined), { kind: "accepted" });
  assert.deepEqual(classifyPowerVerbOutcome({ code: "connection_closed" }), { kind: "accepted" });
  assert.equal(classifyPowerVerbOutcome({ code: "permission_denied", subclass: "step_up_required", message: "m" }).kind, "step_up_required");
  assert.equal(classifyPowerVerbOutcome({ code: "permission_denied", subclass: "verb_capability_scope_not_granted", message: "m" }).kind, "not_authorised");
  assert.equal(classifyPowerVerbOutcome({ code: "internal", message: "m" }).kind, "error");
});

test("the write socket follows the bearer bus and closes on unmount", () => {
  assert.ok(
    /onBearerChange\(\(\) => \{\s*const tx = powerTxRef\.current;\s*if \(tx !== null\) tx\.rotateBearer\(\);/.test(hook),
    "a pair or a purge re-handshakes the power write socket"
  );
  assert.ok(/powerTxRef\.current = null;\s*if \(tx !== null\) void tx\.close\(\);/.test(hook), "closed on unmount");
  assert.ok(/import \{ storedBearer, onBearerChange \} from "\.\.\/\.\.\/runtime\/bearer";/.test(hook));
});

test("must not move: the other write picks and the provider paint are unchanged", () => {
  assert.equal(metadataWriteSocket(true), "stored-bearer");
  assert.equal(audioWriteSocket(true), "stored-bearer");
  assert.equal(kioskWriteSocket(true), "stored-bearer");
  assert.equal(metadataWriteSocket(false), "shared");
  assert.equal(audioWriteSocket(false), "seed");
  assert.equal(providerWriteFeedback({ ok: true }), null);
});
