// Contract (D1 + D2): the operator can open the last plays and the most
// played. Two controls on the library surface, Recently played and Most
// played. They are not browse modes, they do not depend on the selected
// source, and they stay available on a media server. Each control is one
// read with { v } only: library.recently_played (the plugin's default of
// 100 applies) and library.most_played (its default applies). No
// source_id, no path, no limit. A recent row is the URI and when it
// finished, local time, newest first; the same track can appear twice. A
// most-played row is the URI and its count, highest first; a zero count
// is not shown. Playing a row is the library's existing play of that URI
// (append, then play it) - no second request to fetch a title.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-play-history.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeMostPlayed,
  decodeRecentlyPlayed,
  formatFinishedAt
} from "../../src/features/library/play-history.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "library", "useLibrary.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "library", "play-history.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("recently played decodes to uri + finished_at, newest first, repeats kept, empty is empty", () => {
  const rows = decodeRecentlyPlayed({
    v: 1,
    cap: 100,
    plays: [
      { uri: "a/one.flac", finished_at: 1700000100 },
      { uri: "a/two.flac", finished_at: 1700000200 },
      { uri: "a/one.flac", finished_at: 1700000300 }
    ]
  });
  assert.ok(rows !== null);
  assert.deepEqual(rows.map((r) => [r.uri, r.finishedAt]), [
    ["a/one.flac", 1700000300],
    ["a/two.flac", 1700000200],
    ["a/one.flac", 1700000100]
  ]);
  assert.deepEqual(decodeRecentlyPlayed({ v: 1, plays: [] }), []);
  assert.equal(decodeRecentlyPlayed({ v: 1 }), null, "no plays list is not an answer");
  assert.deepEqual(decodeRecentlyPlayed({ v: 1, plays: [{ uri: "", finished_at: 1 }, { uri: "x", finished_at: "soon" }] }), [], "unusable rows are dropped, not invented");
});

test("most played decodes to uri + count, highest first, zero not shown, empty is empty", () => {
  const rows = decodeMostPlayed({
    v: 1,
    tracks: [
      { uri: "b.flac", count: 2, last_finished_at: 5 },
      { uri: "z.flac", count: 0, last_finished_at: 0 },
      { uri: "a.flac", count: 7, last_finished_at: 9 },
      { uri: "c.flac", count: 2, last_finished_at: 3 }
    ]
  });
  assert.ok(rows !== null);
  assert.deepEqual(rows.map((r) => [r.uri, r.count]), [
    ["a.flac", 7],
    ["b.flac", 2],
    ["c.flac", 2]
  ]);
  assert.deepEqual(decodeMostPlayed({ v: 1, tracks: [] }), []);
  assert.equal(decodeMostPlayed({ v: 1 }), null);
  assert.deepEqual(decodeMostPlayed({ v: 1, tracks: [{ uri: "q", count: 0, last_finished_at: 1 }] }), [], "a count of zero is not shown");
});

test("finished_at paints in local time from epoch seconds", () => {
  const s = formatFinishedAt(1700000000);
  assert.equal(s, new Date(1700000000 * 1000).toLocaleString());
  assert.ok(s.length > 0);
});

test("the hook sends each read once with { v } only", () => {
  assert.ok(/recentlyPlayed: \(\) => Promise<LibraryVerbResult<PlayRecord\[\]>>;/.test(hook), "the hook offers recentlyPlayed");
  assert.ok(/mostPlayed: \(\) => Promise<LibraryVerbResult<PlayCount\[\]>>;/.test(hook), "the hook offers mostPlayed");
  assert.ok(/const recentlyPlayed = useCallback\(\s*\(\) => dispatch\("library\.recently_played", \{\}, decodeRecentlyPlayed\),\s*\[dispatch\]\s*\)/.test(hook), "recently_played carries the envelope version and nothing else");
  assert.ok(/const mostPlayed = useCallback\(\s*\(\) => dispatch\("library\.most_played", \{\}, decodeMostPlayed\),\s*\[dispatch\]\s*\)/.test(hook), "most_played carries the envelope version and nothing else");
  assert.equal((code(hook).match(/library\.recently_played/g) ?? []).length, 1, "the verb appears once");
  assert.equal((code(hook).match(/library\.most_played/g) ?? []).length, 1, "the verb appears once");
  assert.ok(/\{ v: PAYLOAD_VERSION, \.\.\.envelope \}/.test(hook), "dispatch adds v");
});

test("the two controls are not browse modes and do not depend on the source", () => {
  const modes = between(surface, "const BROWSE_MODES", "];");
  assert.ok(!/recent|most|history/i.test(modes), "neither control is a browse mode");
  assert.ok(!/setBrowseMode\("recent|setBrowseMode\("most/.test(surface), "no browse-mode entry");
  const open = between(surface, "const onOpenHistory = useCallback(", "}, [");
  assert.ok(/recentlyPlayed\(\)/.test(open) && /mostPlayed\(\)/.test(open), "each control is one read");
  assert.ok(!/selectedSource|source_id|sourceId|isDlnaSource|path|limit/.test(open), "the reads do not depend on the selected source and carry no path or limit");
  assert.equal((open.match(/recentlyPlayed\(\)/g) ?? []).length, 1);
  assert.equal((open.match(/mostPlayed\(\)/g) ?? []).length, 1);
  const controls = between(surface, 'className="library-history-actions"', "</div>");
  assert.ok(/onOpenHistory\("recent"\)/.test(controls) && /onOpenHistory\("most"\)/.test(controls), "two controls");
  assert.ok(!/isDlnaSource|selectedSource/.test(controls), "the controls stay available on a media server");
  assert.ok(/t\("library\.recentlyPlayed"\)/.test(controls) && /t\("library\.mostPlayed"\)/.test(controls), "labelled");
});

test("a row plays through the library's existing play of that URI, and nothing else is fetched", () => {
  const play = between(surface, "const onPlayHistoryRow = useCallback(", "}, [");
  assert.ok(/audioQueue\.appendAndPlay\(\[uri\]\)/.test(play), "append, then play that URI");
  const existing = between(surface, "const onPlayNowFile = useCallback(", "}, [");
  assert.ok(/audioQueue\.appendAndPlay\(\[entry\.uri\]\)/.test(existing), "the library's existing play is the same composition");
  assert.ok(!/playNow\(|loadPlaylist|appendPlaylist|playFromPosition|enqueue\(|browse\(|searchLibrary|drillDimension|getPlaylist/.test(play), "no other verb, no second request");
  const panel = between(surface, 'className="library-history"', "{/* end library-history */}");
  assert.ok(!/browse\(|searchLibrary\(|drillDimension\(|useTrackDetail|artworkUrl/.test(panel), "no second request per row to fetch a title or art");
  assert.ok(/formatFinishedAt\(row\.finishedAt\)/.test(panel), "a recent row shows when it finished, local time");
  assert.ok(/tn\("library\.playCount", row\.count\)/.test(panel), "a most-played row shows its count");
  assert.ok(/\{row\.uri\}/.test(panel), "a row is the URI");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.recentlyPlayed", "library.mostPlayed", "library.historyEmpty", "library.playCount.one", "library.playCount.many", "library.historyClose"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, limit? } with a default of 100 and answers plays / tracks", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "play_history.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct HistoryReadPayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "limit"]);
  assert.ok(/pub\(crate\) const RECENT_CAP: usize = 100;/.test(s), "the default is 100");
  assert.ok(/"plays": plays/.test(s) && /"tracks": tracks/.test(s), "plays and tracks");
  assert.ok(/"uri": p\.uri, "finished_at": p\.finished_at/.test(s), "a play is uri + finished_at");
  assert.ok(/"count": c\.count/.test(s), "a track carries its count");
});
