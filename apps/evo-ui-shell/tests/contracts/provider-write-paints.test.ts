// Contract: a refused provider write must paint.
//
// Field failure: ProvidersPanel called `void setPrivacyMode /
// setPriority / setEnabled(...)` and dropped the result. The hook
// returns { ok: false, message } on a refusal (household lock, scope,
// socket could not open), the list only refreshes on ok, so the toggle
// did not move and nothing said why. The Stored Keys panel already
// awaits and paints r.message; this is that hole on this panel. Now
// the three writes await the hook and paint the hook's message on a
// refusal; a success paints nothing of its own - the re-listed state
// is the paint. No second send. The Metadata write pick is untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  providerWriteFeedback,
  providerWriteOpensHousehold
} from "../../src/features/providers/provider-write-feedback.ts";
import { metadataWriteSocket } from "../../src/features/system/metadata-write-socket.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const panel = src("features/system/ProvidersPanel.tsx");
const hook = src("features/providers/useProviders.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

test("a refused provider write paints the hook's message", () => {
  // The hook's message, verbatim - not a translation, not a guess.
  assert.equal(
    providerWriteFeedback({ ok: false, message: "household_policy_locked: the owner can change this from Settings" }),
    "household_policy_locked: the owner can change this from Settings"
  );
  assert.equal(providerWriteFeedback({ ok: false, message: "" }), "");

  // Each of the three writes awaits the hook and records the refusal.
  for (const [handler, call] of [
    ["onSetPrivacyMode", "setPrivacyMode(mode)"],
    ["onSetPriority", "setPriority(providerId, priority)"],
    ["onSetEnabled", "setEnabled(providerId, enabled)"]
  ] as const) {
    const body = between(panel, `const ${handler} = async`, "};");
    assert.ok(/setWriteError\(null\);/.test(body), `${handler} clears the last refusal first`);
    assert.ok(body.includes(`const r = await ${call};`), `${handler} awaits the hook`);
    assert.ok(/paintWrite\(r\);/.test(body), `${handler} paints through the shared writer`);
    assert.equal((body.match(/await /g) ?? []).length, 1, `${handler}: one send, no second`);
  }
  // The refusal is painted where the list error already is, as an alert.
  assert.ok(
    /\{writeError !== null \? \(\s*<p className="credentials-feedback" role="alert">\s*\{writeError\}\s*<\/p>\s*\) : null\}/.test(panel),
    "the refusal paints as an alert"
  );
  assert.ok(/const \[writeError, setWriteError\] = useState<string \| null>\(null\);/.test(panel));
});

test("a success does not invent copy", () => {
  assert.equal(providerWriteFeedback({ ok: true }), null);
  // No success string anywhere on the panel: the re-listed state is the paint.
  assert.ok(!/providers\.(saved|applied|updated|done|success)/.test(panel), "no invented success copy");
  const en = src("locales/en.ts");
  assert.ok(!/"providers\.(saved|applied|updated|done|success)"/.test(en), "no success key added");
  // The hook still re-lists only on ok, and the panel does not re-list on its own.
  assert.equal((hook.match(/if \(r\.ok\) await refresh\(\);/g) ?? []).length, 3);
  assert.ok(!/refresh\(\)/.test(panel), "the panel never sends a second list");
});

test("the three void drops are gone", () => {
  assert.ok(!/void setPrivacyMode\(/.test(panel), "privacy mode result is not dropped");
  assert.ok(!/void setPriority\(/.test(panel), "priority result is not dropped");
  assert.ok(!/void setEnabled\(/.test(panel), "enable result is not dropped");
  assert.ok(/onClick=\{\(\) => void onSetPrivacyMode\(m\)\}/.test(panel));
  assert.equal((panel.match(/onClick=\{\(\) => void onSetPriority\(p\.providerId, eff [+-] 10\)\}/g) ?? []).length, 2);
  assert.ok(/onClick=\{\(\) => void onSetEnabled\(p\.providerId, !p\.enabled\)\}/.test(panel));
  // Still one handler per hook write - the hook's surface is unchanged.
  assert.ok(/const \{ entries, privacyMode, error, busy, setEnabled, setPriority, setPrivacyMode \} =\s*useProviders\(\);/.test(panel));
});

test("a household lock opens the one door; a scope miss does not", () => {
  assert.equal(
    providerWriteOpensHousehold({
      ok: false,
      message: "locked",
      subclass: "household_policy_locked"
    }),
    true
  );
  assert.equal(
    providerWriteOpensHousehold({
      ok: false,
      message: "scope",
      subclass: "verb_capability_scope_not_granted"
    }),
    false
  );
  assert.equal(providerWriteOpensHousehold({ ok: true }), false);
  assert.ok(/useHouseholdModal\(/.test(panel), "the panel uses the one household host");
  assert.ok(
    /providerWriteOpensHousehold\(r\) && household !== null/.test(panel),
    "a lock opens the existing door"
  );
  assert.ok(
    !/usePair|from\s*"[^"]*\bpair\b[^"]*"/i.test(panel),
    "a provider lock must not open Pair"
  );
});

test("the Metadata write pick is unchanged", () => {
  assert.equal(metadataWriteSocket(true), "stored-bearer");
  assert.equal(metadataWriteSocket(false), "shared");
  const pick = between(hook, "const writeTransport = useCallback", "}, [transport]);");
  assert.ok(/if \(transport === null\) return null;/.test(pick));
  assert.ok(/if \(metadataWriteSocket\(storedBearer\(\) !== undefined\) === "shared"\) \{\s*return transport;\s*\}/.test(pick));
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick));
  assert.ok(/providersSetEnabled\(tx, providerId, enabled\)/.test(hook));
  assert.ok(/providersSetPriority\(tx, providerId, priority\)/.test(hook));
  assert.ok(/providersSetPrivacyMode\(tx, mode\)/.test(hook));
  assert.ok(/providersList\(transport\)/.test(hook));
  // The panel does not reach past the hook to any socket.
  assert.ok(!/WsTransport|storedBearer|tryUseFrameworkTransport|dispatch\(/.test(panel));
});
