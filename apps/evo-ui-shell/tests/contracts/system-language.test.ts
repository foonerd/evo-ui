// Contract: Settings sets the language. A control on the System group -
// not inside a wizard - sends language.set on system.locale. The only
// language offered is en: choosing it sends { v: 1, language: "en" } once,
// and a tag other than en is never sent. The answer { v: 1, language } is
// the language the glass shows, through the existing locale switch; if the
// answer is not the tag that was sent, the glass shows the answered
// language, and never a language the answer did not name. The control
// does not write ui.locale; the ui.locale settings stream that the
// first-boot path follows stays. The verb rides the backup bearer rule - a
// stored bearer on a private socket, no bearer on the seed socket - and is
// not the audio write path; the audio write-socket count stays 14. While a
// send is in flight the control sends nothing.
// Run:
//   node --experimental-strip-types --test tests/contracts/system-language.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LANGUAGE_VERB,
  LOCALE_SHELF,
  OFFERED_LANGUAGES,
  decodeLanguageAnswer,
  languagePayload
} from "../../src/features/system/language.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "system", "useSystemLocale.ts"), "utf8");
const row = readFileSync(join(root, "features", "system", "LanguageSettingsRow.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "system", "language.ts"), "utf8");
const surface = readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8");
const app = readFileSync(join(root, "app", "App.tsx"), "utf8");
const backupHook = readFileSync(join(root, "features", "system", "useSystemBackup.ts"), "utf8");
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

test("the shelf, the verb, the one language offered; a tag other than en is never a payload", () => {
  assert.equal(LOCALE_SHELF, "system.locale");
  assert.equal(LANGUAGE_VERB, "language.set");
  assert.deepEqual([...OFFERED_LANGUAGES], ["en"]);
  assert.deepEqual(languagePayload("en"), { v: 1, language: "en" });
  assert.deepEqual(Object.keys(languagePayload("en") ?? {}), ["v", "language"]);
  for (const tag of ["de", "en-GB", "EN", "pl", "", " en"]) {
    assert.equal(languagePayload(tag), null, `${JSON.stringify(tag)} is not sent`);
  }
});

test("the answer decodes to the language it names, or nothing", () => {
  assert.equal(decodeLanguageAnswer({ v: 1, language: "en" }), "en");
  assert.equal(decodeLanguageAnswer({ v: 1, language: "de" }), "de", "the answered language, whatever was sent");
  assert.equal(decodeLanguageAnswer({ v: 1, language: "" }), null);
  assert.equal(decodeLanguageAnswer({ v: 1 }), null);
  assert.equal(decodeLanguageAnswer(null), null);
});

test("the hook: the backup bearer rule; one send through the payload helper; not the audio write path", () => {
  const c = code(hook);
  assert.ok(/import \{ powerWriteSocket \} from "\.\/power-write-socket";/.test(hook), "the same rule function as the backup verbs");
  const pick = between(c, "const writeTransport = useCallback(", "}, [seedTransport]);");
  assert.ok(/if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return seedTransport\(\);\s*\}/.test(pick), "no bearer: the seed socket");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick), "a stored bearer: a private socket that presents it");
  const seed = between(c, "const seedTransport = useCallback(", "}, []);");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\) \}\)/.test(seed) && !/bearer/i.test(seed), "the seed socket is anonymous");
  assert.equal((c.match(/bearerSource/g) ?? []).length, 1);
  assert.ok(/onBearerChange\(/.test(c) && /\.rotateBearer\(\)/.test(c) && /void tx\.close\(\)/.test(c) && /void seed\.close\(\)/.test(c));
  const set = between(c, "const setLanguage = useCallback(", "}, [writeTransport]);");
  assert.ok(/const payload = languagePayload\(tag\);\s*if \(payload === null\) \{\s*return \{ ok: false,/.test(set), "a tag other than en is refused before any send");
  assert.ok(/pluginRequest\(transport, LOCALE_SHELF, LANGUAGE_VERB, payload\)/.test(set));
  assert.equal((c.match(/pluginRequest\(/g) ?? []).length, 1, "one send");
  assert.ok(/decodeLanguageAnswer\(r\.value\)/.test(set));
  assert.ok(!/tryUseFrameworkTransport|setBearerToken|writeRequest|useAudioOptions|ui\.locale|UI_LOCALE_SETTINGS_KEY|setSetting/.test(c), "not the shared socket, not the audio write path, never ui.locale");
  assert.equal((audioHook.match(/await writeRequest\(/g) ?? []).length, 14, "the audio write-socket count stays 14");
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(!/system\.locale|language\.set/.test(audioHook + socketPin));
  assert.ok(!/locale|language/i.test(code(backupHook)), "the backup hook is untouched");
});

test("the control: on the System group; choosing en sends once; the answered language is what the glass shows; in flight sends nothing; never ui.locale", () => {
  const group = between(surface, "function SystemGroup(", "/* ---------- Placeholder bodies");
  assert.ok(/<LanguageSettingsRow \/>/.test(group), "on the System group");
  assert.ok(!/Wizard|wizard/.test(code(row)), "not inside a wizard");
  const choose = between(row, "const onChoose = async", "\n  };");
  assert.ok(/if \(busy\) return;/.test(choose), "while a send is in flight the control sends nothing");
  assert.equal((choose.match(/setLanguage\(/g) ?? []).length, 1, "one send");
  assert.ok(/const r = await setLanguage\(tag\);/.test(choose));
  assert.ok(/if \(isLocaleId\(r\.value\)\) \{\s*setLocale\(r\.value\);/.test(choose), "the glass shows the answered language through the existing switch");
  assert.equal((code(row).match(/setLocale\(/g) ?? []).length, 1, "the locale switch is only ever the answer");
  assert.ok(!/setLocale\(tag\)|setLocale\("en"\)/.test(row), "never the sent tag");
  assert.ok(/OFFERED_LANGUAGES\.map\(\(tag\) =>/.test(row) && /onClick=\{\(\) => void onChoose\(tag\)\}/.test(row), "only the offered languages can be chosen");
  assert.ok(!/ui\.locale|UI_LOCALE_SETTINGS_KEY|setSetting|writeSetting/.test(code(row)), "the control does not write ui.locale");
  assert.ok(/const runtimeLocale = payload\.settings\[UI_LOCALE_SETTINGS_KEY\];\s*if \(isLocaleId\(runtimeLocale\)\) \{\s*setLocale\(runtimeLocale\);/.test(app), "the ui.locale settings stream stays");
});

test("the strings exist, are ASCII, and carry no row id", () => {
  for (const key of ["settings.language.title", "settings.language.help", "settings.language.name.en", "settings.language.cannotShow"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(m[1]), key + " carries no row id");
  }
  for (const s of [helper, hook, row]) assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in source");
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, language } on system.locale and answers the language in force", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.identity.locale", "src", "lib.rs");
  const mf = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.identity.locale", "manifest.toml");
  if (!existsSync(rs) || !existsSync(mf)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct SetPayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((x) => x[1]);
  assert.deepEqual(fields, ["v", "language"]);
  assert.ok(/"language": \*in_force/.test(s), "the answer is the language in force");
  const m = readFileSync(mf, "utf8");
  // Timezone lift (named, accepted with that row): the respondent list now
  // carries the three timezone verbs beside language.set, and language.set
  // still asks for no write grant.
  const types = between(m, "request_types = [", "]");
  assert.ok(/shelf = "system\.locale"/.test(m) && /"language\.set"/.test(types));
  assert.ok(!/"language\.set" = \{/.test(m), "language.set declares no write or step-up capability");
});
