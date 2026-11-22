// Contract (E1): one control, Forget, on a library file. It is not one
// of the six queue actions in the browse kebab, and that list stays as it
// is. A directory has no such control. The operator confirms; Cancel
// sends nothing; Confirm is one request, library.forget_track, with that
// file's uri and nothing else (the hook adds v). After the answer the URI
// is dropped from every list on screen - the browse entries, the facet
// drill, an open history panel - with no second read. The control never
// calls library.remove_source.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-forget-track.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forgetTrackPayload } from "../../src/features/library/forget-track.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "library", "useLibrary.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const kebab = readFileSync(join(root, "features", "library", "browse-kebab.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// The six ids, read as text (the kebab module is JSX).
const BROWSE_KEBAB_QUEUE_IDS = [...between(kebab, "export const BROWSE_KEBAB_QUEUE_IDS = [", "] as const").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);

test("the payload is the uri alone", () => {
  const p = forgetTrackPayload("Music/a/one.flac");
  assert.deepEqual(Object.keys(p), ["uri"]);
  assert.deepEqual(p, { uri: "Music/a/one.flac" });
  for (const key of ["source_id", "path", "name", "uris"]) {
    assert.ok(!(key in p), key + " is never sent from the glass");
  }
});

test("the hook sends the one verb once, through the payload helper, and never remove_source for it", () => {
  assert.ok(/forgetTrack: \(uri: string\) => Promise<LibraryVerbResult>;/.test(hook), "the hook offers forgetTrack");
  assert.ok(
    /const forgetTrack = useCallback\(\s*\(uri: string\) => dispatch\("library\.forget_track", forgetTrackPayload\(uri\)\),\s*\[dispatch\]\s*\)/.test(hook),
    "forgetTrack is exactly one dispatch of library.forget_track with the helper's payload"
  );
  assert.equal((code(hook).match(/library\.forget_track/g) ?? []).length, 1, "the verb appears once in the hook");
  const block = between(hook, "const forgetTrack = useCallback(", "\n  )");
  assert.ok(!/remove_source|removeSource/.test(block), "forget is not remove_source");
});

test("the six kebab ids stay the six ids and Forget is not among them", () => {
  assert.deepEqual([...BROWSE_KEBAB_QUEUE_IDS], ["play-now", "play-next", "add-queue", "clear-and-play", "add-to-playlist", "save-playlist"]);
  assert.ok(!/forget/i.test(code(kebab)), "the browse kebab does not carry Forget");
  const ids = [...code(kebab).matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, [...BROWSE_KEBAB_QUEUE_IDS], "the builder paints exactly the six");
});

test("the control is on the file tile only; a directory cannot send the verb", () => {
  const fileTile = between(surface, "const renderFileTile = (entry: LibraryEntry) => {", "// ----- render");
  assert.ok(/onClick=\{\(\) => onForgetFile\(entry\)\}/.test(fileTile), "the file tile carries Forget");
  assert.ok(/t\("library\.forget"\)/.test(fileTile), "labelled");
  // The directory tile is the render branch that follows renderFileTile.
  const afterFile = surface.slice(surface.indexOf("const renderFileTile = (entry: LibraryEntry) => {"));
  const dirTile = between(afterFile, 'if (entry.kind === "directory") {', "\n                );");
  assert.ok(/<TrackTile/.test(dirTile) && /placeholderIcon=\{<FolderOpen/.test(dirTile), "the directory tile");
  assert.ok(!/onForgetFile|forgetTrack|forget_track/.test(dirTile), "a directory has no such control");
  const opener = between(surface, "const onForgetFile = useCallback(", "}, [");
  assert.ok(/if \(entry\.kind !== "file"\) return;/.test(opener), "the opener refuses anything but a file");
  assert.ok(/setForgetTarget\(entry\)/.test(opener), "the opener asks; it does not send");
  assert.ok(!/forgetTrack\(|removeSource\(|remove_source/.test(opener), "the opener sends nothing");
  assert.equal((surface.match(/onForgetFile\(entry\)/g) ?? []).length, 1, "one control");
  assert.ok(!/forgetTrack\(|onForgetFile\(|forget_track/.test(between(surface, 'className="library-history"', "{/* end library-history */}")), "no Forget on a history row");
});

test("the operator confirms; cancel sends nothing; confirm is one request and the URI leaves every list with no second read", () => {
  const dialog = between(surface, "{forgetTarget !== null ? (", ") : null}");
  assert.ok(/<ConfirmDialog/.test(dialog), "a confirm dialog");
  assert.ok(/onCancel=\{\(\) => setForgetTarget\(null\)\}/.test(dialog), "cancel closes and sends nothing");
  assert.equal((dialog.match(/forgetTrack\(/g) ?? []).length, 1, "confirm is one request");
  assert.ok(/library\.forgetTrack\(target\.uri\)/.test(dialog) || /forgetTrack\(target\.uri\)/.test(dialog), "the file's uri");
  assert.ok(/dropForgottenUri\(target\.uri\)/.test(dialog), "the URI leaves the lists on screen");
  assert.ok(!/removeSource|remove_source|browseSource\(|browse\(|loadFacet\(|drillDimension\(|recentlyPlayed\(|mostPlayed\(|searchLibrary\(|refresh/i.test(dialog), "no remove_source, no second read");
  const drop = between(surface, "const dropForgottenUri = useCallback(", "}, [");
  assert.ok(/setBrowseState\(/.test(drop) && /setDrillTracks\(/.test(drop) && /setHistoryView\(/.test(drop), "browse entries, the drill and an open history panel all drop it");
  assert.ok(/\.filter\(/.test(drop) && !/browseSource\(|browse\(|loadFacet\(|dispatch|pluginRequest/.test(drop), "a filter, not a read");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.forget", "library.forgetTitle", "library.forgetMessage", "library.forgetAction"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's forget payload reads v and uri, and takes no MPD connection", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "forgotten_tracks.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct ForgetTrackPayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "uri"]);
  const sig = between(s, "pub(crate) async fn handle_forget_track(", ")");
  assert.ok(!/MpdConnection/.test(sig), "nothing about MPD or the file changes");
});
