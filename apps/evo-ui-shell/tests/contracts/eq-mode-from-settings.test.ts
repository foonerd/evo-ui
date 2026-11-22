// Contract: the EQ-on flag is the device's composition_mode on
// options.settings, decoded like every other settings field, set at mount
// and on the changed happening. It is never a session guess: there is no
// useState(false) and no optimistic flip on select_mode. An absent field
// means the player has not reported the mode yet - not that EQ is off -
// and the toggle says so instead of claiming either.
// Run:
//   node --experimental-strip-types --test tests/contracts/eq-mode-from-settings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeAudioOptionsSettings } from "../../src/features/audio/audio-options-decoders.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "EqPanel.tsx"), "utf8");
const options = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");

test("composition_mode decodes like the other fields, and absent means not reported", () => {
  const on = decodeAudioOptionsSettings({ v: 1, composition_mode: "eq_only" });
  assert.ok(on !== null);
  assert.equal(on.compositionMode, "eq_only");
  const off = decodeAudioOptionsSettings({ v: 1, composition_mode: "passthrough" });
  assert.equal(off?.compositionMode, "passthrough");
  const absent = decodeAudioOptionsSettings({ v: 1 });
  assert.equal(absent?.compositionMode, null, "no field is not yet reported, not off");
  const junk = decodeAudioOptionsSettings({ v: 1, composition_mode: "banana" });
  assert.equal(junk?.compositionMode, null, "an unknown token is not a mode");
});

test("the hook reads the flag from settings and keeps no session guess", () => {
  assert.ok(!/useState\(false\)[^\n]*\n?[^\n]*eqModeActive|\[eqModeActive, setEqModeActive\]/.test(hook), "no useState for the EQ mode");
  assert.ok(!/setEqModeActive\(/.test(hook), "no optimistic flip on select_mode");
  assert.ok(/eqMode: settings\?\.compositionMode \?\? null/.test(hook), "the flag is the decoded composition_mode");
  // After a successful select the settings are re-read on the seed socket,
  // so the flag follows the device, not the request.
  assert.ok(
    /const selectEqMode = useCallback\([\s\S]*?if \(outcome\.ok\)[\s\S]*?refreshSettings\(seed\)/.test(hook),
    "a successful select re-reads settings"
  );
});

test("the panel paints on, off, or not yet reported - never a guess", () => {
  assert.ok(/eqMode=\{eqMode\}/.test(options), "the options panel hands the decoded mode down");
  assert.ok(!/modeActive=\{/.test(options), "the session flag is gone from the panel");
  assert.ok(!/eqModeActive/.test(hook), "no session flag anywhere in the hook");
  assert.ok(/const modeActive = eqMode === "eq_only";/.test(panel), "on means eq_only");
  assert.ok(/const modeKnown = eqMode !== null;/.test(panel), "absent is its own state");
  assert.ok(/disabled=\{locked \|\| modeBusy \|\| !modeKnown\}/.test(panel), "the toggle waits for a reported mode");
  assert.ok(/not reported the EQ mode yet/.test(panel), "the unknown state is said");
});
