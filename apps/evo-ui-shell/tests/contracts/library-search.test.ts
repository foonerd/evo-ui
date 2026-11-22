// Contract (F1): the operator can search the library. One field on the
// library surface; the operator submits it. One request per submit,
// library.search_library, with the query and no source_ids; the hook's
// existing v, include_offline and max_results stay. The results are shown
// in the order the answer returns - never sorted on the glass. A hit the
// decoder already understands, a dlna: file included, stays in the list;
// playing it is the library's existing play of that URI. Sources named in
// stale_sources are shown, and an empty result with a named source is not
// a silent blank. Suggestions are not this row.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeSearchLibrary } from "../../src/features/library/library-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "library", "useLibrary.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const decoders = readFileSync(join(root, "features", "library", "library-decoders.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const hit = (uri: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ kind: "file", name, uri, title: null, artist: null, album: null, ...extra });

test("the answer decodes in its own order, a dlna: file hit stays, stale sources are named", () => {
  const decoded = decodeSearchLibrary({
    v: 1,
    results: [
      hit("Music/z/last.flac", "last.flac", { source_id: "local-internal" }),
      hit("dlna:uuid:server-1/12$99", "Stream Thing", { source_id: "dlna-1" }),
      hit("Music/a/first.flac", "first.flac", { source_id: "local-internal" }),
      { kind: "file", name: "no uri" },
      "not an entry"
    ],
    truncated: true,
    stale_sources: ["cloud-1", "dlna-2"]
  });
  assert.ok(decoded !== null);
  assert.deepEqual(decoded.results.map((r) => r.uri), [
    "Music/z/last.flac",
    "dlna:uuid:server-1/12$99",
    "Music/a/first.flac"
  ], "the answer's order, unsorted; the dlna: hit kept; the unusable rows dropped");
  assert.deepEqual(decoded.staleSources, ["cloud-1", "dlna-2"]);
  assert.equal(decoded.truncated, true);
  const empty = decodeSearchLibrary({ v: 1, results: [], truncated: false, stale_sources: ["cloud-1"] });
  assert.ok(empty !== null);
  assert.deepEqual(empty.results, []);
  assert.deepEqual(empty.staleSources, ["cloud-1"], "an empty result still names its sources");
  assert.deepEqual(decodeSearchLibrary({ v: 1, results: [] })?.staleSources, [], "no stale_sources means none");
  assert.equal(decodeSearchLibrary({ v: 1 }), null, "no results list is not an answer");
  assert.equal(decodeSearchLibrary(null), null);
});

test("the decoder never sorts", () => {
  const block = decoders.slice(decoders.indexOf("export function decodeSearchLibrary("));
  const fn = block.slice(0, block.indexOf("\n}\n") + 3);
  assert.ok(!/\.sort\(|localeCompare|\.reverse\(/.test(fn), "the answer order is the list order");
});

test("the hook sends the one verb with query, include_offline and max_results - and the surface sends no source_ids", () => {
  const block = between(hook, "const searchLibrary = useCallback(", "\n  ) as (");
  assert.ok(/query,\s*include_offline: options\?\.includeOffline \?\? false,\s*max_results: options\?\.maxResults \?\? 100/.test(block), "v is added by dispatch; include_offline and max_results stay");
  assert.ok(/dispatch\("library\.search_library", payload, decodeSearchLibrary\)/.test(block), "the answer is decoded with its stale sources");
  assert.equal((code(hook).match(/library\.search_library/g) ?? []).length, 1, "the verb appears once");
  const submit = between(surface, "const onSubmitSearch = useCallback(", "}, [");
  assert.ok(/event\.preventDefault\(\);/.test(submit), "a form submit, handled once");
  assert.ok(/const query = searchDraft\.trim\(\);\s*if \(query\.length === 0\) return;/.test(submit), "an empty field sends nothing");
  // F2 lift (named, accepted with that row): the form submit and a chosen
  // suggestion share one search path, submitSearch, which holds the one
  // library.search_library call on the surface.
  assert.equal((submit.match(/submitSearch\(/g) ?? []).length, 1, "one request per submit");
  assert.ok(!/searchLibrary\(/.test(submit), "the submit goes through the one path");
  const run = between(surface, "const submitSearch = useCallback(", "}, [");
  assert.equal((run.match(/searchLibrary\(/g) ?? []).length, 1, "one request per search");
  assert.ok(/await searchLibrary\(query\)/.test(run), "the query alone - no options, so no source_ids");
  assert.ok(!/sourceIds|source_ids|includeOffline|maxResults|selectedSource/.test(submit + run), "no source_ids, no source scoping on the glass");
  assert.equal((code(surface).match(/searchLibrary\(/g) ?? []).length, 1, "library.search_library is sent from submitSearch and nowhere else - typing does not search");
});

test("the results are painted as they came, a hit plays through the existing play, stale sources are shown", () => {
  const panel = between(surface, 'className="library-search-results"', "{/* end library-search-results */}");
  assert.ok(!/\.sort\(|localeCompare|\.reverse\(/.test(panel), "no client re-rank");
  assert.ok(/searchState\.results\.map\(\(entry\)\s*=>/.test(panel), "the answer's list, in its order");
  assert.ok(/renderFileTile\(entry\)/.test(panel), "a file hit is THE file tile - its Play now is the existing play of that URI");
  assert.ok(!/browse\(|drillDimension\(|searchLibrary\(|useTrackDetail|recentlyPlayed\(|mostPlayed\(/.test(panel), "no request per row");
  assert.ok(/searchState\.staleSources\.length > 0/.test(panel) && /t\("library\.searchStale"/.test(panel), "sources named in stale_sources are shown");
  assert.ok(/searchState\.results\.length === 0/.test(panel) && /t\("library\.searchEmpty"/.test(panel), "an empty result says so");
  const submit = between(surface, "const onSubmitSearch = useCallback(", "}, [");
  assert.ok(!/\.sort\(|localeCompare/.test(submit), "no re-rank on the way in");
  assert.ok(!/dlna|filter\(/.test(submit) && !/\.filter\(\(entry\)/.test(panel), "no hit is dropped on the glass - a dlna: file stays");
  assert.ok(/<form[^>]*className="library-search"[^>]*onSubmit=\{onSubmitSearch\}/.test(surface), "one field, submitted");
  assert.equal((surface.match(/onSubmit=\{onSubmitSearch\}/g) ?? []).length, 1);
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.searchLabel", "library.searchPlaceholder", "library.searchSubmit", "library.searchResults", "library.searchEmpty", "library.searchStale", "library.searchTruncated", "library.searchClose"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads query / source_ids? / include_offline / max_results and answers results + truncated + stale_sources", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "library.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct SearchLibraryPayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "query", "source_ids", "include_offline", "max_results"]);
  assert.ok(/pub\(crate\) source_ids: Option<Vec<String>>/.test(s), "source_ids is optional - the glass omits it");
  const answer = between(s, '"results":       results,', "}))");
  assert.ok(/"truncated":\s*truncated/.test(answer) && /"stale_sources":\s*stale_sources/.test(answer), "results, truncated, stale_sources");
});
