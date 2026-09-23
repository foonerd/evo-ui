// Contract: Settings > Audio writes must ride the stored bearer when
// one exists.
//
// Field failure: useAudioOptions and useHardwareAudio each open a
// private anonymous seed socket and sent every mixer / DSP / DAC write
// on it. After an in-place pair the step-up sitting is bound to
// bearer:<id>; a hardware.audio write on the LAN-trust seed socket
// presented that sitting from another identity, the framework refused
// it as step_up_required, and the card came up again for a password
// that could never satisfy. Writes now ride a private socket that
// presents the stored bearer (read at every handshake, rotated by the
// bearer bus, closed on unmount); with no bearer they stay on the seed
// socket; seed reads and happenings stay on the seed socket either way;
// the seed socket and FrameworkTransport are never given a token; the
// playback sockets are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  audioWriteSocket,
  isHardwareAudioWrite,
  HARDWARE_AUDIO_WRITE_VERBS
} from "../../src/features/audio/audio-write-socket.ts";
import { kioskWriteSocket } from "../../src/features/kiosk/osk-state.ts";
import {
  householdSetAdmission,
  householdWriteSocket
} from "../../src/features/household/household-protection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const options = src("features/audio/useAudioOptions.ts");
const hardware = src("features/audio/useHardwareAudio.ts");

/** The text between two anchors, asserting both are present in order. */
const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

const PICK_RE =
  /if \(audioWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return transportRef\.current;\s*\}/;
const WRITE_SOCKET_RE = /new WsTransport\(\{ url: frameworkUrl\(\), bearerSource: storedBearer \}\)/;
const SEED_SOCKET_RE = /const transport = new WsTransport\(\{ url: frameworkUrl\(\) \}\);/;

const OPTIONS_WRITE_VERBS = [
  "options.set_eq_band",
  "options.save_eq_preset",
  "options.recall_eq_preset",
  "options.delete_eq_preset",
  "options.set_resampling"
];

test("with a stored bearer, an Audio write is not sent on the seed socket", () => {
  assert.equal(audioWriteSocket(true), "stored-bearer");

  // useAudioOptions: one pick, one write path, every write through it.
  const optPick = between(options, "const writeTransport = useCallback", "const writeRequest = useCallback");
  assert.ok(PICK_RE.test(optPick), "options: only the no-bearer case returns the seed socket");
  assert.ok(WRITE_SOCKET_RE.test(optPick), "options: the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? transportRef\.current/.test(optPick), "options: with a bearer the pick never falls back to the seed socket");
  const optWrite = between(options, "const writeRequest = useCallback", "const dispatchSetter = useCallback");
  assert.ok(/const tx = writeTransport\(\);/.test(optWrite) && /pluginRequest\(tx, shelf, requestType, payload\)/.test(optWrite),
    "options: the write path sends on the chosen socket");
  assert.ok(/await writeRequest\(OPTIONS_SHELF, requestType, \{/.test(options), "every options.set_* setter rides the write path");
  for (const verb of OPTIONS_WRITE_VERBS) {
    assert.ok(
      new RegExp(`await writeRequest\\(\\s*OPTIONS_SHELF,\\s*"${verb.split(".").join("\\.")}"`).test(options),
      `${verb} rides the write path`
    );
  }
  assert.ok(/await writeRequest\(\s*COMPOSITION_SHELF,\s*"composition\.select_mode"/.test(options),
    "composition.select_mode is a write of this panel and rides the write path");
  assert.equal((options.match(/await writeRequest\(/g) ?? []).length, 7,
    "seven write sites: dispatchSetter, set_eq_band, select_mode, save / recall / delete preset, set_resampling");
  assert.ok(!/pluginRequest\(\s*transport,\s*OPTIONS_SHELF,\s*(requestType|"options\.(set_|save_|recall_|delete_))/.test(options),
    "no options write is sent by name on the seed socket");
  assert.ok(!/pluginRequest\(\s*transport,\s*COMPOSITION_SHELF/.test(options), "no composition write on the seed socket");

  // useHardwareAudio: the same pick; the shelf's mutating verbs ride it.
  const hwPick = between(hardware, "const writeTransport = useCallback", "const dispatch = useCallback");
  assert.ok(PICK_RE.test(hwPick), "hardware: only the no-bearer case returns the seed socket");
  assert.ok(WRITE_SOCKET_RE.test(hwPick), "hardware: the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? transportRef\.current/.test(hwPick), "hardware: with a bearer the pick never falls back to the seed socket");
  const hwDispatch = between(hardware, "const dispatch = useCallback", "const selectDac = useCallback");
  assert.ok(
    /const transport = isHardwareAudioWrite\(requestType\)\s*\? writeTransport\(\)\s*: transportRef\.current;/.test(hwDispatch),
    "hardware: a mutating verb picks the write socket"
  );
  assert.ok(/pluginRequest\(transport, SHELF, requestType, payload\)/.test(hwDispatch), "hardware: sent on the chosen socket");
  for (const verb of HARDWARE_AUDIO_WRITE_VERBS) {
    assert.equal(isHardwareAudioWrite(verb), true, `${verb} is a write`);
    assert.ok(new RegExp(`dispatch\\(\\s*"${verb.split(".").join("\\.")}"`).test(hardware), `${verb} is sent through dispatch`);
  }
  assert.deepEqual(
    [...HARDWARE_AUDIO_WRITE_VERBS].sort(),
    [
      "hardware.audio.clear_dac",
      "hardware.audio.dsp.set_control",
      "hardware.audio.modder.register_overlay",
      "hardware.audio.modder.remove_overlay",
      "hardware.audio.select_dac"
    ],
    "exactly the plugin manifest's step_up:audio_admin set"
  );
});

test("with no bearer, an Audio write still rides the seed socket", () => {
  assert.equal(audioWriteSocket(false), "seed");
  // The pick's seed branch returns the hook's own seed socket, not a new one.
  for (const hook of [options, hardware]) {
    const pick = between(hook, "const writeTransport = useCallback", "}, []);");
    assert.ok(PICK_RE.test(pick));
    assert.equal((pick.match(/new WsTransport\(/g) ?? []).length, 1, "one constructor in the pick, the bearer one");
  }
});

test("seed reads and happenings stay on the seed socket", () => {
  // The seed sockets are built exactly as before: no bearer, no source.
  assert.ok(SEED_SOCKET_RE.test(options), "options seed socket is anonymous");
  assert.ok(SEED_SOCKET_RE.test(hardware), "hardware seed socket is anonymous");
  assert.equal((options.match(/bearerSource/g) ?? []).length, 1, "options: bearerSource appears once - the write socket");
  assert.equal((hardware.match(/bearerSource/g) ?? []).length, 1, "hardware: bearerSource appears once - the write socket");
  assert.ok(!/bearerToken/.test(options) && !/bearerToken/.test(hardware), "no pinned token in either hook");

  // options reads.
  assert.ok(/pluginRequest\(\s*transport,\s*OPTIONS_SHELF,\s*"options\.get_settings"/.test(options), "get_settings on the seed socket");
  assert.ok(/pluginRequest\(\s*transport,\s*DELIVERY_SHELF,\s*"delivery\.list_outputs"/.test(options), "list_outputs on the seed socket");
  const listPresets = between(options, "const listEqPresets = useCallback", "const saveEqPreset = useCallback");
  assert.ok(/const transport = transportRef\.current;/.test(listPresets) && /pluginRequest\(\s*transport,\s*OPTIONS_SHELF,\s*"options\.list_eq_presets"/.test(listPresets),
    "list_eq_presets on the seed socket");
  const verify = between(options, "const verifyInstall = useCallback", "const emitTestTone = useCallback");
  assert.ok(/const transport = transportRef\.current;/.test(verify) && /pluginRequest\(\s*transport,\s*HARDWARE_AUDIO_SHELF,\s*VERIFY_INSTALL_REQUEST_TYPE/.test(verify),
    "verify_install is a read and stays on the seed socket");
  assert.ok(!/writeTransport\(\)|writeRequest\(/.test(listPresets) && !/writeTransport\(\)|writeRequest\(/.test(verify), "reads never use the write path");
  // The re-read after a write is a read: seed socket.
  assert.equal((options.match(/const seed = transportRef\.current;\s*if \(seed !== null\) await refreshSettings\(seed\);/g) ?? []).length, 2,
    "dispatchSetter and set_resampling re-read on the seed socket");
  assert.ok(!/refreshSettings\(tx\)|refreshSettings\(write/.test(options), "no re-read on the write socket");

  // hardware reads.
  for (const verb of [
    "hardware.audio.current_config",
    "hardware.audio.dsp.list_controls",
    "hardware.audio.modder.list_overlays",
    "hardware.audio.list_dac_catalogue"
  ]) {
    assert.ok(new RegExp(`pluginRequest\\(\\s*transport,\\s*SHELF,\\s*"${verb.split(".").join("\\.")}"`).test(hardware), `${verb} on the seed socket`);
  }
  for (const verb of [
    "hardware.audio.confirm_reboot_required",
    "hardware.audio.current_config",
    "hardware.audio.list_dac_catalogue",
    "hardware.audio.verify_install",
    "hardware.audio.dsp.list_controls",
    "hardware.audio.dsp.get_control",
    "hardware.audio.modder.list_overlays"
  ]) {
    assert.equal(isHardwareAudioWrite(verb), false, `${verb} is a read`);
  }
  assert.ok(/const seed = transportRef\.current;\s*if \(seed !== null\) await refreshState\(seed\);/.test(hardware),
    "the re-read after a hardware write is on the seed socket");

  // Happenings: one subscribe and one onHappening per hook, both on the seed socket.
  for (const hook of [options, hardware]) {
    assert.equal((hook.match(/\.subscribe\(/g) ?? []).length, 1);
    assert.ok(/transport\.subscribe\(\s*"subscribe_happenings"/.test(hook));
    assert.equal((hook.match(/\.onHappening\(/g) ?? []).length, 1);
    assert.ok(/transport\.onHappening\(/.test(hook));
  }

  // The test tone is playback custody (take_custody / course_correct /
  // release_custody on audio.playback) - not an options.* or
  // hardware.audio.* write, and playback is not this row. It stays on
  // the seed socket; pinned so a later move is a visible change.
  const tone = between(options, "const emitTestTone = useCallback", "return {\n    connection");
  assert.ok(/const transport = transportRef\.current;/.test(tone));
  assert.ok(/transport\.dispatch\("take_custody"/.test(tone) && /transport\.dispatch\("course_correct"/.test(tone) && /transport\.dispatch\("release_custody"/.test(tone));
  assert.ok(!/writeTransport\(\)|writeRequest\(/.test(tone));
});

test("FrameworkTransport is never given a token", () => {
  const shared = src("runtime/framework-transport.tsx");
  assert.ok(!/bearerToken|bearerSource|setBearerToken\(/.test(shared));
  for (const hook of [options, hardware]) {
    assert.ok(!/setBearerToken\(/.test(hook), "no pinned token anywhere in the Audio hooks");
    assert.ok(!/useFrameworkTransport|tryUseFrameworkTransport/.test(hook), "the Audio hooks do not reach for the shared socket");
  }
});

test("playback constructors still have no bearerSource", () => {
  for (const rel of [
    "features/queue/useAudioQueue.ts",
    "features/playback/useSpectrum.ts",
    "features/playback/playback-session.ts",
    "features/playback/usePlayback.ts"
  ]) {
    assert.ok(!/bearerSource|bearerToken/.test(src(rel)), `${rel} carries no bearer`);
  }
  assert.ok(/sharedTransport \?\? new WsTransport\(\{ url: frameworkUrl\(\) \}\)/.test(src("features/queue/useAudioQueue.ts")));
  assert.ok(/sharedTransport \?\? new WsTransport\(\{ url: frameworkUrl\(\) \}\)/.test(src("features/playback/useSpectrum.ts")));
});

test("the write socket follows the bearer bus, closes on unmount, and a refused upgrade is an honest refusal", () => {
  for (const hook of [options, hardware]) {
    assert.ok(
      /onBearerChange\(\(\) => \{\s*const tx = writeTxRef\.current;\s*if \(tx !== null\) tx\.rotateBearer\(\);/.test(hook),
      "a pair or a purge re-handshakes the write socket"
    );
    assert.ok(/writeTxRef\.current = null;\s*if \(tx !== null\) void tx\.close\(\);/.test(hook), "closed on unmount");
    assert.ok(/import \{ storedBearer, onBearerChange \} from "\.\.\/\.\.\/runtime\/bearer";/.test(hook));
  }
  const optWrite = between(options, "const writeRequest = useCallback", "const dispatchSetter = useCallback");
  assert.ok(/catch \(err\) \{[\s\S]*?message: err instanceof Error \? err\.message : String\(err\)/.test(optWrite),
    "options: a write socket that could not open is an error result, never a throw out of a setter");
  const hwDispatch = between(hardware, "const dispatch = useCallback", "const selectDac = useCallback");
  assert.ok(/catch \(err\) \{[\s\S]*?message: err instanceof Error \? err\.message : String\(err\)/.test(hwDispatch),
    "hardware: the same honest refusal");
});

test("must not move: the kiosk and household picks are untouched", () => {
  assert.equal(kioskWriteSocket(true), "stored-bearer");
  assert.equal(kioskWriteSocket(false), "shared");
  assert.equal(householdWriteSocket(true), "stored-bearer");
  assert.equal(householdWriteSocket(false), "shared");
  assert.equal(householdSetAdmission(false), "pair-first");
  assert.equal(householdSetAdmission(true), "dispatch");
});
