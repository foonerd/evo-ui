// Contract: the operator sets and clears the alarm. One block on the audio
// options panel, after the sleep timer and before gapless. The operator
// names weekdays (in the order given), a local time and a playlist; typing
// sends nothing. Set sends alarm.set { v: 1, weekdays, time, playlist_name }
// on audio.alarm once; clear sends alarm.clear { v: 1 } once. A bad form -
// empty weekdays, a day twice, a token outside mon..sun, a time that is not
// HH:MM 00-23 / 00-59, an empty trimmed playlist name - sends nothing and
// the alarm on screen stays. A successful set answer is the alarm on
// screen, weekdays in the order answered; a refused set leaves it. A clear
// answered ok leaves no alarm on screen. There is no read: on connect the
// control shows no alarm. Both verbs go through one alarmVerb site on
// audio.alarm, not dispatchSetter. A locked panel sends nothing.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-alarm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALARM_SHELF,
  ALARM_VERBS,
  ALARM_WEEKDAYS,
  alarmSetPayload,
  decodeAlarmAnswer,
  decodeAlarmCleared,
  toggleWeekday
} from "../../src/features/audio/alarm.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "alarm.ts"), "utf8");
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

test("the shelf, the two verbs, the seven tokens", () => {
  assert.equal(ALARM_SHELF, "audio.alarm");
  assert.deepEqual(ALARM_VERBS, { set: "alarm.set", clear: "alarm.clear" });
  assert.deepEqual([...ALARM_WEEKDAYS], ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
});

test("the set payload keeps the operator's order; a bad form is null", () => {
  assert.deepEqual(alarmSetPayload(["fri", "mon", "wed"], "07:30", "  Morning "), { weekdays: ["fri", "mon", "wed"], time: "07:30", playlist_name: "Morning" }, "the order given, not reordered");
  assert.deepEqual(Object.keys(alarmSetPayload(["mon"], "00:00", "A") ?? {}), ["weekdays", "time", "playlist_name"]);
  assert.deepEqual(alarmSetPayload(["sun"], "23:59", "A")?.time, "23:59", "the edges are inside");
  assert.equal(alarmSetPayload([], "07:30", "Morning"), null, "empty weekdays");
  assert.equal(alarmSetPayload(["mon", "mon"], "07:30", "Morning"), null, "a day named twice");
  assert.equal(alarmSetPayload(["mon", "Mon"], "07:30", "Morning"), null, "a token outside the seven (case)");
  assert.equal(alarmSetPayload(["monday"], "07:30", "Morning"), null, "a token outside the seven");
  for (const bad of ["7:30", "07:3", "24:00", "07:60", "0730", "07:30:00", " 07:30", "ab:cd", ""]) {
    assert.equal(alarmSetPayload(["mon"], bad, "Morning"), null, `time ${JSON.stringify(bad)}`);
  }
  assert.equal(alarmSetPayload(["mon"], "07:30", "   "), null, "an empty trimmed playlist name");
  assert.ok(!/\.sort\(/.test(code(helper)), "nothing is reordered");
});

test("toggling a day appends it or takes it out, never reorders", () => {
  assert.deepEqual(toggleWeekday([], "fri"), ["fri"]);
  assert.deepEqual(toggleWeekday(["fri"], "mon"), ["fri", "mon"]);
  assert.deepEqual(toggleWeekday(["fri", "mon", "wed"], "mon"), ["fri", "wed"]);
});

test("the answers decode: the set answer is the alarm in the order answered; clear ok is true", () => {
  assert.deepEqual(decodeAlarmAnswer({ v: 1, alarm: { weekdays: ["sat", "mon"], time: "09:15", playlist_name: "Weekend" } }), { weekdays: ["sat", "mon"], time: "09:15", playlistName: "Weekend" });
  assert.equal(decodeAlarmAnswer({ v: 1, alarm: { weekdays: [], time: "09:15", playlist_name: "W" } }), null);
  assert.equal(decodeAlarmAnswer({ v: 1, alarm: { weekdays: ["mon"], time: 915, playlist_name: "W" } }), null);
  assert.equal(decodeAlarmAnswer({ v: 1, alarm: { weekdays: ["mon"], time: "09:15", playlist_name: "" } }), null);
  assert.equal(decodeAlarmAnswer({ v: 1 }), null);
  assert.equal(decodeAlarmCleared({ v: 1, status: "ok" }), true);
  assert.equal(decodeAlarmCleared({ v: 1, status: "no" }), null);
  assert.equal(decodeAlarmCleared(null), null);
});

test("the hook: one alarmVerb site on audio.alarm; not dispatchSetter; no read", () => {
  const block = between(hook, "const alarmVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1);
  assert.ok(/await writeRequest\(ALARM_SHELF, requestType, \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "audio.alarm, { v: 1, ...payload }");
  assert.ok(!/dispatchSetter|OPTIONS_SHELF|ZONES_SHELF|DELIVERY_SHELF|refreshSettings|transportRef/.test(block), "not dispatchSetter, no other shelf, no read");
  assert.ok(/const setAlarm = useCallback\(\s*\(payload: AlarmSetPayload\) => alarmVerb\(ALARM_VERBS\.set, payload, decodeAlarmAnswer\)/.test(hook));
  assert.ok(/const clearAlarm = useCallback\(\s*\(\) => alarmVerb\(ALARM_VERBS\.clear, \{\}, decodeAlarmCleared\)/.test(hook), "clear sends { v: 1 } only");
  assert.ok(!/pluginRequest\(\s*transport,\s*ALARM_SHELF/.test(hook), "no read on audio.alarm");
  assert.equal((code(hook).match(/"alarm\.(set|clear)"|"audio\.alarm"/g) ?? []).length, 0, "the verbs and the shelf are named once, in the helper");
  assert.ok(!/alarm\./.test(between(hook, "const seed = async (): Promise<void> => {", "// Happening handler")), "nothing is read on connect");
  assert.ok(hook.indexOf("const alarmVerb = useCallback(") < hook.indexOf("const listEqPresets = useCallback("), "before listEqPresets, clear of the test-tone slice");
  assert.ok(/const setSleepTimer = useCallback\(/.test(hook) && /const zoneVerb = useCallback\(/.test(hook) && /const sceneVerb = useCallback\(/.test(hook), "the other sites stay their own");
});

test("the block sits after the sleep timer and before gapless; typing sends nothing; set and clear send once; a refused set leaves the alarm; locked sends nothing", () => {
  const sleepEnd = panel.indexOf("{/* end audio-sleep-timer */}");
  const alarmAt = panel.indexOf('className="audio-alarm"');
  const alarmEnd = panel.indexOf("{/* end audio-alarm */}");
  const gaplessAt = panel.indexOf('htmlFor="audio-gapless"');
  assert.ok(sleepEnd > 0 && alarmAt > sleepEnd && alarmEnd > alarmAt && gaplessAt > alarmEnd, "after the sleep timer, before gapless");
  const block = between(panel, 'className="audio-alarm"', "{/* end audio-alarm */}");
  assert.ok(!/(onInput|onChange)=\{[^}]*(\bsetAlarm\(|\bclearAlarm\(|onSetAlarm|onClearAlarm)/.test(block), "typing sends nothing");
  assert.ok(/onInput=\{\(ev\) => setAlarmTimeDraft\(/.test(block) && /onInput=\{\(ev\) => setAlarmPlaylistDraft\(/.test(block), "the fields only fill drafts");
  assert.ok(/onClick=\{\(\) => setAlarmDays\(\(cur\) => toggleWeekday\(cur, day\)\)\}/.test(block), "a day button only edits the draft");
  assert.ok(/onClick=\{\(\) => void onSetAlarm\(\)\}/.test(block) && /onClick=\{\(\) => void onClearAlarm\(\)\}/.test(block));
  assert.ok(/alarmError !== null/.test(block) && /role="alert"/.test(block), "a refusal paints under the control");
  assert.ok(!/setSleepTimer|onArmSleepTimer|onCancelSleepTimer/.test(block), "not the sleep timer");
  const set = between(panel, "const onSetAlarm = async", "\n  };");
  assert.ok(/if \(locked\) return;/.test(set), "locked sends nothing");
  assert.ok(/const payload = alarmSetPayload\(alarmDays, alarmTimeDraft, alarmPlaylistDraft\);\s*if \(payload === null\) return;/.test(set), "a bad form sends nothing, the alarm on screen stays");
  assert.equal((set.match(/setAlarm\(/g) ?? []).length, 1, "set sends once");
  assert.ok(/if \(r\.ok\) \{\s*setAlarmShown\(r\.value\);\s*\} else \{\s*setAlarmError\(r\.message\);\s*\}/.test(set), "the answer is the alarm on screen; a refusal leaves it");
  assert.ok(!/setAlarmShown\(null\)/.test(set), "a refused set never clears the alarm on screen");
  assert.ok(!/\.sort\(/.test(set + block), "the weekdays are never reordered");
  const clear = between(panel, "const onClearAlarm = async", "\n  };");
  assert.ok(/if \(locked\) return;/.test(clear));
  assert.equal((clear.match(/clearAlarm\(/g) ?? []).length, 1, "clear sends once");
  assert.ok(/if \(r\.ok\) \{\s*setAlarmShown\(null\);\s*\} else \{\s*setAlarmError\(r\.message\);\s*\}/.test(clear), "ok leaves no alarm; a refusal leaves it");
  assert.ok(/useState<Alarm \| null>\(null\)/.test(panel), "on connect the control shows no alarm");
  assert.equal((panel.match(/setAlarmShown\(/g) ?? []).length, 2, "the alarm on screen changes only on a set answer or a clear answer");
});

test("the write-socket count is 14 and names alarmVerb on audio.alarm; the sleep timer, zone EQ and scene pins follow", () => {
  assert.equal((code(hook).match(/await writeRequest\(/g) ?? []).length, 14);
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(socketPin.includes("/const alarmVerb = useCallback\\([\\s\\S]*?await writeRequest\\(ALARM_SHELF, requestType, \\{/"), "the pin names alarmVerb on audio.alarm");
  assert.ok(/alarmVerb \(alarm\.set and alarm\.clear, audio\.alarm\)/.test(socketPin));
  for (const f of ["audio-sleep-timer.test.ts", "audio-zone-eq.test.ts", "audio-scenes.test.ts"]) {
    const pin = readFileSync(join(here, f), "utf8");
    assert.ok(/length, 14/.test(pin) && !/length, 13\b/.test(pin), f + " follows to 14");
  }
});

test("the strings exist and are ASCII; no row ids in source or locales", () => {
  for (const key of ["audioopt.alarm", "audioopt.alarmDays", "audioopt.alarmTime", "audioopt.alarmPlaylist", "audioopt.alarmPlaylistPlaceholder", "audioopt.alarmSet", "audioopt.alarmClear", "audioopt.alarmNone", "audioopt.alarmShown", "audioopt.alarmDay.mon", "audioopt.alarmDay.tue", "audioopt.alarmDay.wed", "audioopt.alarmDay.thu", "audioopt.alarmDay.fri", "audioopt.alarmDay.sat", "audioopt.alarmDay.sun"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b|sleep timer/i.test(m[1]), key + " is operator-facing, carries no row id, and is not the sleep timer");
  }
  const alarmBlock = between(panel, 'className="audio-alarm"', "{/* end audio-alarm */}");
  for (const [name, s] of [["helper", helper], ["panel block", alarmBlock], ["alarm handlers", between(panel, "const onSetAlarm = async", "const onGaplessChange")]] as const) {
    assert.ok(!/\b[A-Z][0-9]\b/.test(s), name + " carries no row id");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, weekdays, time, playlist_name } and answers { v, alarm } and { v, status }", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.alarm", "src", "lib.rs");
  const mf = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.alarm", "manifest.toml");
  if (!existsSync(rs) || !existsSync(mf)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct SetPayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "weekdays", "time", "playlist_name"]);
  assert.ok(/struct AlarmResponse \{\s*v: u32,\s*alarm: Alarm,\s*\}/.test(s));
  assert.ok(/struct StatusResponse \{\s*v: u32,\s*status: &'static str,\s*\}/.test(s));
  assert.ok(/shelf = "audio\.alarm"/.test(readFileSync(mf, "utf8")));
});
