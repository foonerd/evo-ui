// Contract: Display writes must ride the stored bearer when one exists.
//
// Field failure: every kiosk verb went out on the shared page-lifetime
// LAN-trust socket, which is never given a bearer. After a pair the
// household set already opened a stored-bearer write socket; kiosk
// writes did not, so a paired browser's rotation / brightness / touch
// writes kept riding an identity it had outgrown. Writes now ride a
// private socket presenting the stored bearer (read at every handshake,
// rotated by the bearer bus, closed on unmount); with no bearer they
// stay on the shared socket; reads stay shared either way; the shared
// socket is still never given a token.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kioskWriteSocket } from "../../src/features/kiosk/osk-state.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const remote = src("features/kiosk/kiosk-remote.ts");

test("with a stored bearer, a kiosk write is not sent on the shared transport", () => {
  assert.equal(kioskWriteSocket(true), "stored-bearer");
  const pick = remote.slice(remote.indexOf("const writeTransport = useCallback"), remote.indexOf("const dispatch = useCallback"));
  assert.ok(
    /if \(kioskWriteSocket\(storedBearer\(\) !== undefined\) === "shared"\) \{\s*return transport;\s*\}/.test(pick),
    "only the no-bearer case returns the shared transport"
  );
  assert.ok(
    /new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick),
    "the write socket reads the stored bearer at every handshake"
  );
  const dispatchBlock = remote.slice(remote.indexOf("const dispatch = useCallback"), remote.indexOf("// READ:"));
  assert.ok(/const tx = writeTransport\(\);/.test(dispatchBlock) && /pluginRequest\(tx, KIOSK_SHELF, verb, payload(?:, opts)?\)/.test(dispatchBlock),
    "every write goes through the chosen socket");
  assert.ok(!/pluginRequest\(transport, KIOSK_SHELF, verb/.test(dispatchBlock), "no write on the shared transport by name");
});

test("with no bearer, a kiosk write still rides the shared transport", () => {
  assert.equal(kioskWriteSocket(false), "shared");
});

test("FrameworkTransport is never given a token", () => {
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared));
  assert.ok(!/transport\.setBearerToken|transport\.rotateBearer/.test(remote), "kiosk-remote never touches the shared socket's bearer");
  assert.ok(!/setBearerToken\(/.test(remote), "no pinned token anywhere in kiosk-remote");
});

test("reads stay on the shared socket; the write socket follows the bus and closes on unmount", () => {
  const read = remote.slice(remote.indexOf("// READ:"), remote.indexOf("return {\n    ready"));
  assert.ok(/pluginRequest\(transport, KIOSK_SHELF, "get_display_state", \{\}\)/.test(read), "get_display_state on the shared socket");
  assert.ok(!/writeTransport\(\)/.test(read), "reads never use the write socket");
  assert.ok(/onBearerChange\(\(\) => \{\s*const tx = writeTxRef\.current;\s*if \(tx !== null\) tx\.rotateBearer\(\);/.test(remote), "a pair or purge re-handshakes the write socket");
  assert.ok(/writeTxRef\.current = null;\s*if \(tx !== null\) void tx\.close\(\);/.test(remote), "closed on unmount");
  // A refused upgrade on the write socket is an honest refusal, not a throw.
  assert.ok(/catch \(err\) \{[\s\S]*?ok: false,\s*message: err instanceof Error/.test(remote));
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if kiosk writes stop reaching system.kiosk, if a verb is
// added or dropped, or if a second write path appears beside the one
// chosen socket.

test("LOCK kiosk writes reach system.kiosk: this shelf, exactly these verbs, one write call site and one read", () => {
  assert.match(remote, /const KIOSK_SHELF = "system\.kiosk";/);
  const verbs = [...new Set([...remote.matchAll(/dispatch\("([a-z_]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(verbs, [
    "launch_touch_calibration",
    "set_brightness",
    "set_cursor",
    "set_display_rotation",
    "set_enabled",
    "set_osk",
    "set_sleep_inhibit_while_playing",
    "set_sleep_timeout",
    "set_touch_calibration"
  ]);
  const calls = [...remote.matchAll(/pluginRequest\(([a-zA-Z]+), KIOSK_SHELF, ([^,]+),/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(calls, ["tx:verb", 'transport:"get_display_state"'], "one write call site on the chosen socket, one read on the shared one");
  assert.equal((remote.match(/pluginRequest\(/g) ?? []).length, 2);
});
