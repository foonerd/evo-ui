// Contract: Settings sets the timezone. A control on the System group,
// next to the language row, not inside a wizard. On open it sends
// timezone.get { v: 1 } and timezone.list { v: 1 } on system.locale: the
// get paints the zone in force, the list is the picker. A failed get names
// no zone; a failed list is not an empty picker. Choosing a name from that
// list sends timezone.set { v: 1, timezone } once; a name not on the list,
// and Factory, are never sent. The answer { v: 1, timezone } is the zone the
// glass shows. While a set is in flight the control sends nothing, and the
// glass stays busy until the answer. A household lock paints the locked
// line and opens the one household door - not a generic refuse. The set
// rides the language / backup bearer rule; the two reads ride the seed
// socket with no write grant. None of it is the audio write path; the
// audio write-socket count stays 14. The glass never calls
// alarm.reschedule and never writes ui.locale.
// Run:
//   node --experimental-strip-types --test tests/contracts/system-timezone.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TIMEZONE_SHELF,
  TIMEZONE_VERBS,
  decodeTimezoneAnswer,
  decodeTimezoneList,
  timezoneReadPayload,
  timezoneSetPayload
} from "../../src/features/system/timezone.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "system", "useSystemTimezone.ts"), "utf8");
const row = readFileSync(join(root, "features", "system", "TimezoneSettingsRow.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "system", "timezone.ts"), "utf8");
const surface = readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8");
const languageHook = readFileSync(join(root, "features", "system", "useSystemLocale.ts"), "utf8");
const languageRow = readFileSync(join(root, "features", "system", "LanguageSettingsRow.tsx"), "utf8");
const audioHook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
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

const LIST = ["Africa/Abidjan", "Europe/Prague", "UTC"];

test("the shelf, the three verbs, the payloads; a name not on the list, Factory, or no list is never sent", () => {
  assert.equal(TIMEZONE_SHELF, "system.locale");
  assert.deepEqual(TIMEZONE_VERBS, { get: "timezone.get", list: "timezone.list", set: "timezone.set" });
  assert.deepEqual(timezoneReadPayload(), { v: 1 });
  assert.deepEqual(timezoneSetPayload("Europe/Prague", LIST), { v: 1, timezone: "Europe/Prague" });
  assert.deepEqual(Object.keys(timezoneSetPayload("UTC", LIST) ?? {}), ["v", "timezone"]);
  assert.equal(timezoneSetPayload("Europe/Atlantis", LIST), null, "not on the list");
  assert.equal(timezoneSetPayload("Factory", [...LIST, "Factory"]), null, "Factory is never sent");
  assert.equal(timezoneSetPayload("europe/prague", LIST), null, "the exact name only");
  assert.equal(timezoneSetPayload("UTC", null), null, "no list, no set");
  assert.equal(timezoneSetPayload("", LIST), null);
});

test("the answers decode: the zone in force; the list in the answer's order; a failed or empty list is no list", () => {
  assert.equal(decodeTimezoneAnswer({ v: 1, timezone: "Europe/Prague" }), "Europe/Prague");
  assert.equal(decodeTimezoneAnswer({ v: 1, timezone: "" }), null);
  assert.equal(decodeTimezoneAnswer({ v: 1 }), null, "no zone is named");
  assert.deepEqual(decodeTimezoneList({ v: 1, timezones: ["UTC", "Africa/Abidjan", 3, "", "Factory", "Europe/Prague"] }), ["UTC", "Africa/Abidjan", "Europe/Prague"], "the answer's order; Factory is not a choice");
  assert.equal(decodeTimezoneList({ v: 1, timezones: [] }), null, "an empty list is not a picker");
  assert.equal(decodeTimezoneList({ v: 1 }), null);
  assert.equal(decodeTimezoneList(null), null);
  assert.ok(!/\.sort\(/.test(code(helper)), "the list is not reordered");
});

test("the hook: reads on the seed socket; the set by the language / backup bearer rule; never the audio write path", () => {
  const c = code(hook);
  assert.ok(/import \{ powerWriteSocket \} from "\.\/power-write-socket";/.test(hook));
  const pick = between(c, "const writeTransport = useCallback(", "}, [seedTransport]);");
  assert.ok(/if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return seedTransport\(\);\s*\}/.test(pick), "no bearer: the seed socket");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick), "a stored bearer: a private socket that presents it");
  const seed = between(c, "const seedTransport = useCallback(", "}, []);");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\) \}\)/.test(seed) && !/bearer/i.test(seed), "the seed socket is anonymous");
  assert.equal((c.match(/bearerSource/g) ?? []).length, 1);
  assert.ok(/onBearerChange\(/.test(c) && /\.rotateBearer\(\)/.test(c) && /void tx\.close\(\)/.test(c) && /void seed\.close\(\)/.test(c));
  const get = between(c, "const getTimezone = useCallback(", "}, [seedTransport]);");
  const list = between(c, "const listTimezones = useCallback(", "}, [seedTransport]);");
  for (const [name, block, verb] of [["get", get, "get"], ["list", list, "list"]] as const) {
    assert.ok(/const transport = seedTransport\(\);/.test(block) && !/writeTransport/.test(block), name + " is a read on the seed socket");
    assert.ok(new RegExp(`pluginRequest\\(transport, TIMEZONE_SHELF, TIMEZONE_VERBS\\.${verb}, timezoneReadPayload\\(\\)\\)`).test(block), name + " sends { v: 1 }");
  }
  const set = between(c, "const setTimezone = useCallback(", "}, [writeTransport]);");
  assert.ok(/const payload = timezoneSetPayload\(name, list\);\s*if \(payload === null\) \{\s*return \{ ok: false,/.test(set), "a name not on the list, or Factory, is refused before any send");
  assert.ok(/const transport = writeTransport\(\);/.test(set));
  assert.ok(/pluginRequest\(transport, TIMEZONE_SHELF, TIMEZONE_VERBS\.set, payload\)/.test(set));
  assert.ok(/subclass:/.test(set), "the refusal keeps its class for the household door");
  assert.equal((c.match(/pluginRequest\(/g) ?? []).length, 3, "one send per verb");
  assert.ok(!/tryUseFrameworkTransport|setBearerToken|writeRequest|useAudioOptions|ui\.locale|UI_LOCALE_SETTINGS_KEY|alarm\.reschedule|audio\.alarm|language\.set/.test(c), "not the shared socket, not the audio write path, no ui.locale, no alarm call, not the language verb");
  assert.equal((audioHook.match(/await writeRequest\(/g) ?? []).length, 14, "the audio write-socket count stays 14");
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(!/timezone/i.test(code(audioHook) + code(languageHook) + code(languageRow)), "the audio hook and the language row are untouched");
});

test("the control: next to the language row; reads on open; a failed get names no zone; a failed list is no picker; one send; busy until the answer; the answer is the zone shown; the household door", () => {
  const group = between(surface, "function SystemGroup(", "/* ---------- Placeholder bodies");
  assert.ok(/<LanguageSettingsRow \/>\s*<TimezoneSettingsRow \/>/.test(group), "next to the language row, on the System group");
  assert.ok(!/Wizard|wizard/.test(code(row)), "not inside a wizard");
  const open = between(row, "useEffect(() => {", "}, []);");
  assert.equal((open.match(/getTimezone\(\)/g) ?? []).length, 1, "the get, once, on open");
  assert.equal((open.match(/listTimezones\(\)/g) ?? []).length, 1, "the list, once, on open");
  assert.ok(/if \(g\.ok\) \{\s*setZone\(g\.value\);\s*\} else \{\s*setZoneUnread\(true\);\s*\}/.test(open), "a failed get names no zone");
  assert.ok(/if \(l\.ok\) \{\s*setZones\(l\.value\);\s*\} else \{\s*setListUnread\(true\);\s*\}/.test(open), "a failed list is not an empty picker");
  assert.ok(!/setZones\(\[\]\)/.test(row), "no empty picker is ever painted");
  assert.ok(/zones === null \? \(/.test(row) && /listUnread/.test(row), "no list: a line, not a picker");
  const choose = between(row, "const onChoose = async", "\n  };");
  assert.ok(/if \(busy\) return;/.test(choose), "while a set is in flight the control sends nothing");
  assert.ok(/if \(timezoneSetPayload\(name, zones\) === null\) return;/.test(choose), "a name not on the list, or Factory, is not sent");
  assert.equal((choose.match(/setTimezone\(/g) ?? []).length, 1, "one send");
  assert.ok(/setBusy\(true\);[\s\S]*await setTimezone\(name, zones\);\s*setBusy\(false\);/.test(choose), "busy until the answer");
  assert.ok(/if \(r\.ok\) \{\s*setZone\(r\.value\);/.test(choose), "the answered zone is the zone shown");
  assert.ok(!/setZone\(name\)/.test(row), "never the chosen name");
  assert.ok(/isHouseholdLocked\(r\)/.test(choose) && /t\("household\.locked\.body"\)/.test(choose) && /household\.open\(\)/.test(choose), "a household lock paints and opens the one household door");
  assert.ok(/const household = useHouseholdModal\(\);/.test(row));
  assert.ok(/disabled=\{busy\}/.test(row), "the picker is busy while the set waits");
  assert.ok(!/ui\.locale|UI_LOCALE_SETTINGS_KEY|setLocale|alarm/.test(code(row)), "no locale switch, no ui.locale, no alarm");
});

test("the strings exist, are ASCII, and carry no row id", () => {
  for (const key of ["settings.timezone.title", "settings.timezone.help", "settings.timezone.choose", "settings.timezone.unread", "settings.timezone.listUnread", "settings.timezone.setting"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(m[1]), key + " carries no row id");
  }
  for (const s of [helper, hook, row]) assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in source");
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, timezone } and { v }, answers timezone and timezones, and gates the set at write:system_admin", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.identity.locale", "src", "lib.rs");
  const mf = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.identity.locale", "manifest.toml");
  if (!existsSync(rs) || !existsSync(mf)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const zone = [...between(s, "struct ZonePayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((x) => x[1]);
  assert.deepEqual(zone, ["v", "timezone"]);
  const read = [...between(s, "struct ReadPayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((x) => x[1]);
  assert.deepEqual(read, ["v"]);
  assert.ok(/"timezone": zone/.test(s) && /"timezones": zones/.test(s));
  const m = readFileSync(mf, "utf8");
  assert.ok(/"timezone\.set" = \{ kind = "write", scope = "system_admin" \}/.test(m), "the set is write:system_admin");
  for (const v of ["timezone.set", "timezone.get", "timezone.list"]) assert.ok(m.includes(`"${v}"`));
});
