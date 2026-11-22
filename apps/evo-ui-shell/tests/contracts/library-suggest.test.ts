// Contract (F2): the search field offers suggestions while the operator
// types. The same field. A keystroke does not search and does not suggest
// at once: when typing pauses, one request, library.suggest, with that
// prefix and nothing else. A later keystroke replaces the pending prefix,
// so only the latest one is sent. An empty field, spaces included, sends
// nothing and clears the list. Suggestions are shown in the answer's
// order. Choosing one puts the string in the field and submits the
// existing search once - library.search_library with the query and no
// source_ids. Voice is not this row.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-suggest.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SUGGEST_PAUSE_MS,
  decodeSuggestions,
  suggestPayload
} from "../../src/features/library/suggest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "library", "useLibrary.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "library", "suggest.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the suggest payload is the prefix alone", () => {
  const p = suggestPayload("bee");
  assert.deepEqual(Object.keys(p), ["prefix"]);
  assert.deepEqual(p, { prefix: "bee" });
  for (const key of ["query", "source_ids", "limit", "max_results", "include_offline"]) {
    assert.ok(!(key in p), key + " is never sent from the glass");
  }
  assert.ok(SUGGEST_PAUSE_MS >= 200 && SUGGEST_PAUSE_MS <= 600, "a pause in typing, not a keystroke and not a wait");
});

test("the answer decodes in its own order, strings only, no sort and no dedupe on the glass", () => {
  assert.deepEqual(decodeSuggestions({ v: 1, suggestions: ["Zed", "alpha", "Zed", "", 3, "mid"] }), ["Zed", "alpha", "Zed", "mid"]);
  assert.deepEqual(decodeSuggestions({ v: 1, suggestions: [] }), []);
  assert.equal(decodeSuggestions({ v: 1 }), null);
  assert.equal(decodeSuggestions("no"), null);
  const fn = code(helper).slice(code(helper).indexOf("export function decodeSuggestions("));
  assert.ok(!/\.sort\(|localeCompare|new Set\(/.test(fn), "the answer order is the list order");
});

test("the hook sends the one verb once, through the payload helper", () => {
  assert.ok(/suggest: \(prefix: string\) => Promise<LibraryVerbResult<string\[\]>>;/.test(hook), "the hook offers suggest");
  assert.ok(
    /const suggest = useCallback\(\s*\(prefix: string\) => dispatch\("library\.suggest", suggestPayload\(prefix\), decodeSuggestions\),\s*\[dispatch\]\s*\)/.test(hook),
    "suggest is exactly one dispatch of library.suggest with the helper's payload"
  );
  assert.equal((code(hook).match(/library\.suggest/g) ?? []).length, 1, "the verb appears once in the hook");
});

test("a keystroke does not search and does not suggest at once; the pause sends the latest prefix; an empty field sends nothing and clears", () => {
  const input = between(surface, "const onSearchInput = useCallback(", "}, [");
  assert.ok(!/searchLibrary\(|submitSearch\(|onSubmitSearch\(/.test(input), "a keystroke never searches");
  assert.ok(/window\.clearTimeout\(suggestTimer\.current\)/.test(input), "a later keystroke replaces the pending prefix");
  assert.ok(/const prefix = value\.trim\(\);\s*if \(prefix\.length === 0\) \{\s*suggestSeq\.current \+= 1;\s*setSuggestions\(\[\]\);\s*return;\s*\}/.test(input), "an empty field, spaces included, sends nothing and clears the list");
  assert.ok(/suggestTimer\.current = window\.setTimeout\(/.test(input) && /SUGGEST_PAUSE_MS\s*\)/.test(input), "the request waits for a pause");
  const timer = between(input, "window.setTimeout(", "SUGGEST_PAUSE_MS");
  assert.equal((timer.match(/suggest\(/g) ?? []).length, 1, "one request per pause");
  assert.ok(/await suggest\(prefix\)/.test(timer), "that prefix and nothing else");
  assert.ok(/if \(seq !== suggestSeq\.current\) return;/.test(timer), "a stale answer does not paint over a newer prefix");
  assert.ok(!/suggest\(/.test(input.slice(0, input.indexOf("window.setTimeout("))), "nothing is sent before the pause");
  assert.ok(/onInput=\{\(ev\) => onSearchInput\(\(ev\.currentTarget as HTMLInputElement\)\.value\)\}/.test(surface), "the same field");
  assert.equal((surface.match(/<form[^>]*className="library-search"/g) ?? []).length, 1, "no second search field");
  assert.ok(!/useEffect\(\(\) => \{[^}]*suggest\(/.test(surface), "no effect suggests on render");
});

test("the suggestions paint in the answer's order; choosing one fills the field and submits the existing search once", () => {
  const list = between(surface, 'className="library-suggestions"', "</ul>");
  assert.ok(/suggestions\.map\(\(s(, i)?\)\s*=>/.test(list), "the answer's list");
  assert.ok(!/\.sort\(|localeCompare|\.filter\(/.test(list), "as they came");
  assert.ok(/onClick=\{\(\) => onChooseSuggestion\(s\)\}/.test(list), "choosing one");
  const choose = between(surface, "const onChooseSuggestion = useCallback(", "}, [");
  assert.ok(/setSearchDraft\(s\)/.test(choose), "the string goes in the field");
  assert.ok(/setSuggestions\(\[\]\)/.test(choose) && /window\.clearTimeout\(suggestTimer\.current\)/.test(choose) && /suggestSeq\.current \+= 1/.test(choose), "the list closes and no pending suggest fires after the choice");
  assert.equal((choose.match(/submitSearch\(/g) ?? []).length, 1, "the existing search, once");
  assert.ok(!/searchLibrary\(|suggest\(/.test(choose), "no direct send from the choice");
  // One search path. submitSearch holds the one library.search_library
  // call on the surface; the form submit and the choice both go through it.
  const run = between(surface, "const submitSearch = useCallback(", "}, [");
  assert.equal((run.match(/searchLibrary\(/g) ?? []).length, 1, "one request per search");
  assert.ok(/await searchLibrary\(query\)/.test(run), "the query alone - no source_ids");
  assert.ok(!/sourceIds|source_ids|selectedSource/.test(run));
  assert.equal((code(surface).match(/searchLibrary\(/g) ?? []).length, 1, "library.search_library is sent from submitSearch and nowhere else on the surface");
  const submit = between(surface, "const onSubmitSearch = useCallback(", "}, [");
  assert.ok(/event\.preventDefault\(\);/.test(submit) && /submitSearch\(query\)/.test(submit) && !/searchLibrary\(/.test(submit), "the form submit goes through the one path");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.suggestions"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, prefix } and answers suggestions; an empty prefix is an empty list", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "suggest.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct SuggestPayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "prefix"]);
  assert.ok(/"suggestions":\s*suggestions/.test(s), "the answer carries suggestions");
  assert.ok(/if prefix\.is_empty\(\) \{\s*return Vec::new\(\);/.test(s), "an empty prefix is an empty list");
});
