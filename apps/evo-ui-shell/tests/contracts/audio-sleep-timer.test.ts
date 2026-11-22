// Contract (H2): the operator can arm a sleep timer. The control sits
// after the crossfade field on the options panel; it is not the crossfade
// field and it is not read back from settings - the glass never paints an
// armed timer from options.get_settings. One write site, setSleepTimer,
// calls writeRequest on audio.options with { v, seconds, fade_ms }; it does
// not go through dispatchSetter. seconds and fade_ms are whole numbers,
// zero or greater; anything else sends nothing; there is no cap. Arm sends
// the two numbers once, when the operator commits. Cancel sends
// { seconds: 0, fade_ms: 0 } and nothing else. A refusal paints under the
// control.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-sleep-timer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SLEEP_TIMER_CANCEL,
  parseWholeNumber,
  sleepTimerPayload
} from "../../src/features/audio/sleep-timer.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const decoders = readFileSync(join(root, "features", "audio", "audio-options-decoders.ts"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "sleep-timer.ts"), "utf8");
const socketPin = readFileSync(join(here, "audio-write-socket.test.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the payload is { seconds, fade_ms }, whole numbers zero or greater, no cap; anything else is null", () => {
  assert.deepEqual(sleepTimerPayload(1800, 30000), { seconds: 1800, fade_ms: 30000 });
  assert.deepEqual(Object.keys(sleepTimerPayload(1, 0) ?? {}), ["seconds", "fade_ms"]);
  assert.deepEqual(sleepTimerPayload(0, 0), { seconds: 0, fade_ms: 0 });
  assert.deepEqual(sleepTimerPayload(864000, 600000), { seconds: 864000, fade_ms: 600000 }, "no cap");
  assert.equal(sleepTimerPayload(-1, 0), null, "negative seconds");
  assert.equal(sleepTimerPayload(60, -1), null, "negative fade");
  assert.equal(sleepTimerPayload(1.5, 0), null, "non-whole seconds");
  assert.equal(sleepTimerPayload(60, 0.5), null, "non-whole fade");
  assert.equal(sleepTimerPayload(Number.NaN, 0), null);
  assert.equal(sleepTimerPayload(60, Number.POSITIVE_INFINITY), null);
  assert.deepEqual(SLEEP_TIMER_CANCEL, { seconds: 0, fade_ms: 0 }, "cancel is the two zeros and nothing else");
  assert.equal(parseWholeNumber("90"), 90);
  assert.equal(parseWholeNumber(" 7 "), 7);
  assert.equal(parseWholeNumber(""), null, "an empty field is not zero");
  assert.equal(parseWholeNumber("  "), null);
  assert.equal(parseWholeNumber("1.5"), null);
  assert.equal(parseWholeNumber("-3"), null);
  assert.equal(parseWholeNumber("1e3"), null);
  assert.equal(parseWholeNumber("abc"), null);
  assert.ok(!/crossfade|dispatchSetter|get_settings/i.test(code(helper)), "the helper is not the crossfade and reads no settings");
});

test("the hook: one write site, setSleepTimer, on audio.options with { v, seconds, fade_ms }; not dispatchSetter; refuses before a send", () => {
  const block = between(hook, "const setSleepTimer = useCallback(", "\n  );");
  assert.ok(/const payload = sleepTimerPayload\(seconds, fadeMs\);\s*if \(payload === null\) \{\s*return \{ ok: false,/.test(block), "a non-whole or negative number sends nothing");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1, "one write");
  assert.ok(/await writeRequest\(OPTIONS_SHELF, "options\.set_sleep_timer", \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "audio.options, the sleep verb, { v, seconds, fade_ms }");
  assert.ok(!/dispatchSetter|set_crossfade_seconds|refreshSettings|transportRef/.test(block), "not dispatchSetter, not the crossfade verb, no settings re-read");
  assert.equal((code(hook).match(/options\.set_sleep_timer/g) ?? []).length, 1, "sent from one place");
  assert.ok(!/dispatchSetter\(\s*"options\.set_sleep_timer"/.test(hook), "dispatchSetter never sends it");
  assert.ok(/const setCrossfadeSeconds = useCallback\(\s*\(value: number\) => dispatchSetter\("options\.set_crossfade_seconds", value\)/.test(hook), "crossfade stays the crossfade, through dispatchSetter");
  assert.ok(hook.indexOf("const setSleepTimer = useCallback(") < hook.indexOf("const listEqPresets = useCallback("), "before listEqPresets, clear of the test-tone slice");
});

test("the timer is not read back from settings", () => {
  assert.ok(!/sleep/i.test(code(decoders)), "the settings decoder carries no timer");
  assert.ok(!/refreshSettings[\s\S]{0,80}sleep|sleep[\s\S]{0,80}refreshSettings/i.test(code(hook)), "no settings read rides the timer");
  assert.ok(!/settings\??\.sleep|settings\??\.[a-zA-Z]*Sleep|sleep_timer/.test(code(panel)), "the panel paints no timer from settings");
});

test("the control sits after the crossfade field; arm sends once on commit; cancel sends the two zeros; a refusal paints under it", () => {
  const crossfadeAt = panel.indexOf('htmlFor="audio-crossfade"');
  const sleepAt = panel.indexOf('className="audio-sleep-timer"');
  const gaplessAt = panel.indexOf('htmlFor="audio-gapless"');
  assert.ok(crossfadeAt > 0 && sleepAt > crossfadeAt && sleepAt < gaplessAt, "after the crossfade field");
  const sleep = between(panel, 'className="audio-sleep-timer"', "{/* end audio-sleep-timer */}");
  assert.ok(!/onCrossfadeChange|setCrossfadeSeconds|audio-crossfade/.test(sleep), "not the crossfade field");
  assert.ok(!/onChange=\{[^}]*setSleepTimer|onInput=\{[^}]*setSleepTimer|onInput=\{[^}]*onArmSleepTimer/.test(sleep), "typing sends nothing");
  assert.ok(/onClick=\{\(\) => void onArmSleepTimer\(\)\}/.test(sleep) && /onClick=\{\(\) => void onCancelSleepTimer\(\)\}/.test(sleep), "arm and cancel are commits");
  assert.ok(/sleepError !== null/.test(sleep) && /role="alert"/.test(sleep), "a refusal paints under the control");
  const arm = between(panel, "const onArmSleepTimer = async", "\n  };");
  assert.ok(/const seconds = parseWholeNumber\(sleepSecondsDraft\);\s*const fadeMs = parseWholeNumber\(sleepFadeDraft\);\s*if \(seconds === null \|\| fadeMs === null\) return;/.test(arm), "an empty or non-whole field sends nothing");
  assert.equal((arm.match(/setSleepTimer\(/g) ?? []).length, 1, "arm sends once");
  assert.ok(/await setSleepTimer\(seconds, fadeMs\)/.test(arm));
  const cancel = between(panel, "const onCancelSleepTimer = async", "\n  };");
  assert.equal((cancel.match(/setSleepTimer\(/g) ?? []).length, 1);
  assert.ok(/await setSleepTimer\(SLEEP_TIMER_CANCEL\.seconds, SLEEP_TIMER_CANCEL\.fade_ms\)/.test(cancel), "cancel sends { seconds: 0, fade_ms: 0 }");
  assert.ok(!/setCrossfadeSeconds|dispatchSetter/.test(arm + cancel));
  assert.ok(/onChange=\{\(ev\) =>\s*void onCrossfadeChange\(/.test(panel), "the crossfade control is as it was");
});

test("the write-socket pin names setSleepTimer on audio.options; the zone EQ and scene pins follow its count", () => {
  // Alarm lift (named, accepted with that row): the count follows the
  // write-socket pin to 14; setSleepTimer stays its own site.
  assert.equal((code(hook).match(/await writeRequest\(/g) ?? []).length, 14);
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(socketPin.includes('/const setSleepTimer = useCallback\\([\\s\\S]*?await writeRequest\\(OPTIONS_SHELF, "options\\.set_sleep_timer"/'), "the pin names setSleepTimer on audio.options");
  assert.ok(/setSleepTimer \(options\.set_sleep_timer, audio\.options\)/.test(socketPin));
  const zoneEq = readFileSync(join(here, "audio-zone-eq.test.ts"), "utf8");
  const scenes = readFileSync(join(here, "audio-scenes.test.ts"), "utf8");
  assert.ok(/\.length, 14,/.test(zoneEq) && /length, 14,/.test(zoneEq), "the zone EQ pin follows to 14");
  assert.ok(/\.length, 14\)/.test(scenes) && /length, 14,/.test(scenes), "the scene pin follows to 14");
});

test("the strings exist, are ASCII, and do not call it crossfade", () => {
  for (const key of ["audioopt.sleepTimer", "audioopt.sleepSeconds", "audioopt.sleepFadeMs", "audioopt.sleepArm", "audioopt.sleepCancel", "audioopt.sleepNote"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/crossfade|cross-fade|cross fade/i.test(m[1]), key + " does not call it crossfade");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, seconds, fade_ms } on options.set_sleep_timer", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.options", "src", "lib.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct SetSleepTimerPayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "seconds", "fade_ms"]);
  assert.ok(/seconds: u32/.test(between(s, "struct SetSleepTimerPayload {", "\n}")) && /fade_ms: u32/.test(between(s, "struct SetSleepTimerPayload {", "\n}")), "whole numbers, zero or greater");
  assert.ok(s.includes('"options.set_sleep_timer"'));
});
