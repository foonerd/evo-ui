// Contract (F3): a mic on the search field runs that search. One mic
// control beside the existing field, using the browser speech
// recognition this shell already has (runtime/input/voice.ts). A
// recognised "search ..." puts those words in the field and goes through
// submitSearch once - library.search_library with the query and no
// source_ids. "play", "pause" and "next" do not search, and this mic
// sends nothing for them: it adds no voice plane anywhere else. A browser
// without speech recognition shows that and sends nothing. The verb
// dispatcher's search arm no longer sends the query through
// courseCorrect: a search utterance is not a steward command. The kiosk
// grant is not this row.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-search-voice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_VOICE_PATTERNS, matchUtterance } from "../../src/runtime/input/voice.ts";
import { searchVoiceDispatcher } from "../../src/features/library/search-voice.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const dispatcher = readFileSync(join(root, "runtime", "input", "dispatcher.ts"), "utf8");
const voice = readFileSync(join(root, "runtime", "input", "voice.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "library", "search-voice.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the grammar this shell already has: 'search jazz' is a search; 'play' is not; 'search' alone is nothing", () => {
  assert.deepEqual(matchUtterance("search jazz", DEFAULT_VOICE_PATTERNS), { kind: "search", query: "jazz" });
  assert.deepEqual(matchUtterance("search  late night  ", DEFAULT_VOICE_PATTERNS), { kind: "search", query: "late night" });
  assert.deepEqual(matchUtterance("play", DEFAULT_VOICE_PATTERNS), { kind: "play" });
  assert.deepEqual(matchUtterance("pause", DEFAULT_VOICE_PATTERNS), { kind: "pause" });
  assert.deepEqual(matchUtterance("next", DEFAULT_VOICE_PATTERNS), { kind: "next" });
  assert.equal(matchUtterance("search", DEFAULT_VOICE_PATTERNS), null);
  assert.equal(matchUtterance("", DEFAULT_VOICE_PATTERNS), null);
  assert.ok(/const verb = matchUtterance\(text, patterns\);/.test(voice), "the session uses the same matcher");
});

test("the search mic's dispatcher: a search utterance runs the search once; play, pause, next send nothing", async () => {
  const sent: string[] = [];
  const d = searchVoiceDispatcher((q) => sent.push(q));
  const search = matchUtterance("search jazz", DEFAULT_VOICE_PATTERNS);
  assert.ok(search !== null);
  const r1 = await d.dispatch(search, "voice");
  assert.equal(r1.ok, true);
  assert.deepEqual(sent, ["jazz"], "'search jazz' sends the search once");
  for (const text of ["play", "pause", "next", "previous", "stop", "volume up"]) {
    const v = matchUtterance(text, DEFAULT_VOICE_PATTERNS);
    assert.ok(v !== null, text);
    const r = await d.dispatch(v, "voice");
    assert.equal(r.ok, false, text + " is not this mic's to send");
    assert.equal(r.error?.code, "not_a_search");
  }
  assert.deepEqual(sent, ["jazz"], "nothing else was sent");
  const r2 = await d.dispatch({ kind: "search", query: "   " }, "voice");
  assert.equal(r2.ok, false, "an empty query sends nothing");
  assert.deepEqual(sent, ["jazz"]);
  assert.ok(!/courseCorrect|pluginRequest|fetch\(|client\./.test(code(helper)), "the mic's dispatcher touches no wire of its own");
});

test("the verb dispatcher's search arm no longer sends through courseCorrect", () => {
  const route = between(dispatcher, "async function routeOp(", "\nfunction invalidVerb(");
  const searchArm = between(route, 'case "search":', 'case "play_now":');
  assert.ok(!/courseCorrect|client\./.test(searchArm), "a search utterance is not a steward command");
  assert.ok(/code: "search_not_steward"/.test(searchArm), "it answers with a structured refusal, not a wire send");
  assert.equal((code(dispatcher).match(/courseCorrect\(/g) ?? []).length, 2, "course_correct and play_now still route; search does not");
  assert.ok(!/verb: "search"/.test(code(dispatcher)), "no search verb reaches the steward");
});

test("one mic beside the field; a recognised search fills the field and goes through submitSearch once; unsupported is shown", () => {
  assert.equal((surface.match(/startVoiceInput\(/g) ?? []).length, 1, "one voice session start, on the search mic");
  const toggle = between(surface, "const onToggleVoice = useCallback(", "}, [");
  assert.ok(/startVoiceInput\(\s*searchVoiceDispatcher\(onVoiceSearch\)/.test(toggle), "the session dispatches into the search mic's dispatcher");
  assert.ok(/kind === "unsupported"/.test(toggle) && /t\("library\.voiceUnsupported"\)/.test(toggle), "a browser without speech recognition shows that");
  assert.ok(!/searchLibrary\(|submitSearch\(|courseCorrect|verbs\.dispatch|runtime\./.test(toggle), "the toggle itself sends nothing");
  const onSearch = between(surface, "const onVoiceSearch = useCallback(", "}, [");
  assert.ok(/setSearchDraft\(query\)/.test(onSearch), "the words go in the field");
  assert.equal((onSearch.match(/submitSearch\(/g) ?? []).length, 1, "the existing search, once");
  assert.ok(!/searchLibrary\(|suggest\(|courseCorrect/.test(onSearch), "no direct send");
  assert.equal((code(surface).match(/searchLibrary\(/g) ?? []).length, 1, "library.search_library is still sent from submitSearch and nowhere else");
  const form = between(surface, '<form className="library-search"', "</form>");
  assert.ok(/onClick=\{onToggleVoice\}/.test(form), "the mic sits beside the field, inside the one form");
  assert.equal((form.match(/onClick=\{onToggleVoice\}/g) ?? []).length, 1, "one mic");
  assert.ok(/type="button"/.test(between(form, "onClick={onToggleVoice}", "</button>")) || /type="button"[\s\S]{0,200}onClick=\{onToggleVoice\}/.test(form), "the mic is not a submit");
  assert.equal((surface.match(/<form[^>]*className="library-search"/g) ?? []).length, 1, "no second search field");
  assert.ok(!/mountVoice|voicePlane|verbs\.dispatch/.test(surface), "no voice plane anywhere else on the surface");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.voiceStart", "library.voiceStop", "library.voiceListening", "library.voiceUnsupported", "library.voiceHint", "library.voiceNoMatch"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});
