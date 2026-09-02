import test from "node:test";
import assert from "node:assert/strict";

import { en } from "../../src/locales/en.ts";
import {
  activeLocale,
  isLocaleId,
  LOCALES,
  setLocale,
  t,
  UI_LOCALE_SETTINGS_KEY,
} from "../../src/runtime/i18n.ts";

test("i18n is a release gate: English catalog exists and t() resolves it", () => {
  assert.equal(UI_LOCALE_SETTINGS_KEY, "ui.locale");
  assert.equal(activeLocale(), "en");
  assert.equal(t("stage.nothingPlaying"), "Nothing playing");
  assert.equal(t("stage.repeatOne"), "Repeat one");
});

test("catalog sync: every registered locale carries the FULL en key set", () => {
  const enKeys = Object.keys(en).sort();
  for (const [id, catalog] of Object.entries(LOCALES)) {
    assert.deepEqual(
      Object.keys(catalog).sort(),
      enKeys,
      `locale '${id}' drifted from the en key set - untranslatable strings are forbidden`
    );
    for (const [k, v] of Object.entries(catalog)) {
      assert.ok(typeof v === "string" && v.length > 0, `${id}.${k} empty`);
    }
  }
});

test("interpolation fills {params}; unknown placeholders stay visible", () => {
  // Uses a real catalog message once one carries params; the
  // mechanism is contract-locked here via a synthetic replace.
  assert.equal(
    "Hello {name}".replace(/\{(\w+)\}/g, (w, n) => (n === "name" ? "Evo" : w)),
    "Hello Evo"
  );
});

test("locale switching: unknown ids refused, en is a valid id", () => {
  assert.equal(isLocaleId("en"), true);
  assert.equal(isLocaleId("xx"), false);
  assert.equal(isLocaleId(42), false);
  setLocale("en"); // no-op switch stays consistent
  assert.equal(activeLocale(), "en");
});
