// Contract: Settings > Metadata writes must ride the stored bearer when
// one exists.
//
// Field failure: useCredentials and useProviders sent every mutation
// (credential_put / credential_delete / online_providers_set_*) on
// tryUseFrameworkTransport() - the page-lifetime LAN-trust socket that
// is never given a token. After an in-place pair the sitting and the
// write scope live on bearer:<id>; a write on the shared socket
// presented that sitting from the LAN-trust identity, so a household
// policy protecting Metadata refused it (household_policy_locked) and
// the card could never satisfy. Writes now ride a lazy private socket
// that presents the stored bearer (read at every handshake, rotated by
// the bearer bus, closed on unmount, fail closed with no WebSocket);
// with no bearer they stay on the shared socket; the lists stay on the
// shared socket either way; FrameworkTransport is never given a token;
// the Audio write pick and the reboot reminder are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { metadataWriteSocket } from "../../src/features/system/metadata-write-socket.ts";
import { audioWriteSocket } from "../../src/features/audio/audio-write-socket.ts";
import { rebootReminderDue } from "../../src/features/audio/reboot-reminder.ts";
import { kioskWriteSocket } from "../../src/features/kiosk/osk-state.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const credentials = src("features/credentials/useCredentials.ts");
const providers = src("features/providers/useProviders.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const PICK_RE =
  /if \(metadataWriteSocket\(storedBearer\(\) !== undefined\) === "shared"\) \{\s*return transport;\s*\}/;
const WRITE_SOCKET_RE = /new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/;
const HONEST_RE = /catch \(err\) \{[\s\S]*?message: err instanceof Error \? err\.message : String\(err\)/;

test("with a stored bearer, a credential/provider write is not sent on the shared transport", () => {
  assert.equal(metadataWriteSocket(true), "stored-bearer");

  // useCredentials: the pick, and both writes through it.
  const credPick = between(credentials, "const writeTransport = useCallback", "const addKey = useCallback");
  assert.ok(PICK_RE.test(credPick), "credentials: only the no-bearer case returns the shared transport");
  assert.ok(WRITE_SOCKET_RE.test(credPick), "credentials: the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? transport/.test(credPick), "credentials: with a bearer the pick never falls back to the shared socket");
  const addKey = between(credentials, "const addKey = useCallback", "const removeKey = useCallback");
  const removeKey = between(credentials, "const removeKey = useCallback", "return { entries, error, addKey, removeKey, refresh };");
  assert.ok(/const tx = writeTransport\(\);/.test(addKey) && /credentialPut\(tx, \{/.test(addKey), "credential_put rides the chosen socket");
  assert.ok(/const tx = writeTransport\(\);/.test(removeKey) && /credentialDelete\(tx, pluginId, keyHash\)/.test(removeKey), "credential_delete rides the chosen socket");
  assert.ok(!/credentialPut\(transport|credentialDelete\(transport/.test(credentials), "no credential write on the shared transport by name");

  // useProviders: the same pick, all three set verbs through it.
  const provPick = between(providers, "const writeTransport = useCallback", "const setEnabled = useCallback");
  assert.ok(PICK_RE.test(provPick), "providers: only the no-bearer case returns the shared transport");
  assert.ok(WRITE_SOCKET_RE.test(provPick), "providers: the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? transport/.test(provPick), "providers: with a bearer the pick never falls back to the shared socket");
  const writes = between(providers, "const setEnabled = useCallback", "return {\n    entries,");
  assert.ok(/providersSetEnabled\(tx, providerId, enabled\)/.test(writes), "set_enabled rides the chosen socket");
  assert.ok(/providersSetPriority\(tx, providerId, priority\)/.test(writes), "set_priority rides the chosen socket");
  assert.ok(/providersSetPrivacyMode\(tx, mode\)/.test(writes), "set_privacy_mode rides the chosen socket");
  assert.equal((writes.match(/const tx = writeTransport\(\);/g) ?? []).length, 3, "three write sites, three picks");
  assert.ok(!/providersSet\w+\(transport/.test(providers), "no provider write on the shared transport by name");
});

test("with no bearer, a credential/provider write still rides the shared transport", () => {
  assert.equal(metadataWriteSocket(false), "shared");
  for (const hook of [credentials, providers]) {
    const pick = between(hook, "const writeTransport = useCallback", "}, [transport]);");
    assert.ok(PICK_RE.test(pick));
    // A page with no framework transport at all (designer / tests) has
    // nothing to write to, bearer or not - the same not-connected
    // refusal as before.
    assert.ok(/if \(transport === null\) return null;/.test(pick), "no shared transport, no write socket");
    assert.equal((pick.match(/new WsTransport\(/g) ?? []).length, 1, "one constructor in the pick, the bearer one");
  }
});

test("lists stay on the shared transport", () => {
  const credRefresh = between(credentials, "const refresh = useCallback", "useEffect(() => {");
  assert.ok(/credentialListKeys\(transport, pluginId\)/.test(credRefresh), "credential_list_keys on the shared transport");
  assert.ok(!/writeTransport\(\)/.test(credRefresh), "the list never uses the write socket");
  const provRefresh = between(providers, "const refresh = useCallback", "useEffect(() => {");
  assert.ok(/providersList\(transport\)/.test(provRefresh), "online_providers_list on the shared transport");
  assert.ok(!/writeTransport\(\)/.test(provRefresh), "the list never uses the write socket");
  // The re-list after a write is the same shared list.
  assert.ok(/if \(!r\.ok\) return \{ ok: false, message: r\.message \};\s*await refresh\(\);/.test(credentials));
  assert.equal((providers.match(/if \(r\.ok\) await refresh\(\);/g) ?? []).length, 3);
  for (const hook of [credentials, providers]) {
    assert.ok(/const transport = tryUseFrameworkTransport\(\);/.test(hook), "the shared transport is still the page's");
    assert.equal((hook.match(/bearerSource/g) ?? []).length, 1, "bearerSource appears once - the write socket");
    assert.ok(!/bearerToken/.test(hook), "no pinned token");
  }
});

test("FrameworkTransport is never given a token", () => {
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared));
  for (const hook of [credentials, providers]) {
    assert.ok(!/setBearerToken\(|transport\.rotateBearer/.test(hook), "the hooks never touch the shared socket's bearer");
  }
});

test("the write socket follows the bearer bus, closes on unmount, and a refused upgrade is an honest refusal", () => {
  for (const hook of [credentials, providers]) {
    assert.ok(
      /onBearerChange\(\(\) => \{\s*const tx = writeTxRef\.current;\s*if \(tx !== null\) tx\.rotateBearer\(\);/.test(hook),
      "a pair or a purge re-handshakes the write socket"
    );
    assert.ok(/writeTxRef\.current = null;\s*if \(tx !== null\) void tx\.close\(\);/.test(hook), "closed on unmount");
    assert.ok(/import \{ storedBearer, onBearerChange \} from "\.\.\/\.\.\/runtime\/bearer";/.test(hook));
  }
  const addKey = between(credentials, "const addKey = useCallback", "const removeKey = useCallback");
  const removeKey = between(credentials, "const removeKey = useCallback", "return { entries, error, addKey, removeKey, refresh };");
  assert.ok(HONEST_RE.test(addKey) && HONEST_RE.test(removeKey), "credentials: a write socket that could not open is an error result");
  assert.ok(
    /function socketRefusal\(err: unknown\): ProviderActionResult \{\s*return \{\s*ok: false,\s*message: err instanceof Error \? err\.message : String\(err\)/.test(providers),
    "providers: a socket that could not open is an error result"
  );
  const writes = between(providers, "const setEnabled = useCallback", "return {\n    entries,");
  // busy is released on that path too - no stuck controls.
  assert.equal((writes.match(/catch \(err\) \{\s*setBusy\(false\);\s*return socketRefusal\(err\);/g) ?? []).length, 3,
    "providers: each write site releases busy and returns the refusal");
});

test("must not move: the Audio write pick and the reboot reminder are unchanged", () => {
  assert.equal(audioWriteSocket(true), "stored-bearer");
  assert.equal(audioWriteSocket(false), "seed");
  assert.equal(kioskWriteSocket(true), "stored-bearer");
  assert.equal(rebootReminderDue({ pending: true, since: 10, dismissedSince: 10 }), false);
  assert.equal(rebootReminderDue({ pending: true, since: 11, dismissedSince: 10 }), true);
  const hardware = src("features/audio/useHardwareAudio.ts");
  assert.ok(/const transport = isHardwareAudioWrite\(requestType\)\s*\? writeTransport\(\)\s*: transportRef\.current;/.test(hardware));
  assert.ok(/setPendingReboot\(decoded\.pending\);\s*setPendingRebootSince\(decoded\.setAtMs\);/.test(hardware));
  const panel = src("features/audio/AudioOptionsPanel.tsx");
  assert.ok(/onClick=\{dismissRebootReminder\}/.test(panel));
});
