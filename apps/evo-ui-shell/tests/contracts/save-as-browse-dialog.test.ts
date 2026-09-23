// Contract: Save as playlist on a browse tile opens a name
// dialog. The default is the folder / artist / album / genre /
// year / file title. Confirm writes; cancel writes nothing.
// Silent create is how the glass looked like nothing happened.
//
// Add to playlist stays the picker. Queue save-as stays the
// queue dialog. The browse kebab list is not restyled. Artist
// / album artwork rows are not this row.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(join(here, "..", "..", "src", rel), "utf8");

const surface = src("features/library/LibrarySurface.tsx");
const dialogs = src("components/dialogs.tsx");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

test("Save as on folder, facet, DLNA and file only opens the name dialog", () => {
  const facet = between(surface, "const onFacetSave = useCallback(", "const onDirectoryQueue = useCallback(");
  assert.match(facet, /setSaveAsTarget\(\{/);
  assert.match(facet, /kind: "criteria"/);
  assert.match(facet, /name: storedPlaylistName\(value\)/);
  assert.ok(!/saveSelection|createPlaylist|runAction/.test(facet), "no write until confirm");

  const dir = between(surface, "const onDirectorySave = useCallback(", "const onToggleFavourite = useCallback(");
  assert.match(dir, /setSaveAsTarget\(\{/);
  assert.match(dir, /dimension: "folder"/);
  assert.match(dir, /name: storedPlaylistName\(entry\.name\)/);
  assert.ok(!/saveSelection|runAction/.test(dir));

  const dlna = between(surface, "const onDlnaContainerSave = useCallback(", "const onDirectorySave = useCallback(");
  assert.match(dlna, /kind: "container"/);
  assert.match(dlna, /name: storedPlaylistName\(entry\.name\)/);
  assert.ok(!/saveSelectionContainer|runAction/.test(dlna));

  const file = between(surface, "const onSaveFile = useCallback(", "const onEnqueueFile = useCallback(");
  assert.match(file, /kind: "uris"/);
  assert.match(file, /storedPlaylistName\(entry\.title \?\? entry\.name\)/);
  assert.ok(!/createPlaylist|runAction/.test(file));
});

test("the dialog pre-fills the tile name and writes only on Save", () => {
  const dlg = between(surface, "{saveAsTarget !== null ? (", "{removeTarget !== null ? (");
  assert.match(dlg, /<PromptDialog/);
  assert.match(dlg, /title=\{t\("collection\.saveAsPlaylist"\)\}/);
  assert.match(dlg, /label=\{t\("playlist\.nameLabel"\)\}/);
  assert.match(dlg, /initialValue=\{saveAsTarget\.name\}/);
  assert.match(dlg, /hint=\{t\("queue\.saveAsHint"\)\}/);
  assert.match(dlg, /confirmLabel=\{t\("dialog\.save"\)\}/);
  assert.match(dlg, /playlists\.saveSelection\(\s*playlistName,\s*target\.selection,\s*"create"\s*\)/);
  assert.match(dlg, /playlists\.saveSelectionContainer\(/);
  assert.match(dlg, /playlists\.createPlaylist\(playlistName\)/);
  assert.match(dlg, /setFeedback\(t\("library\.savedAsPlaylist", \{ name: playlistName \}\)\)/);
  assert.match(dialogs, /initialValue = ""/);
  assert.equal(en["library.savedAsPlaylist"], 'Saved as "{name}".');
  assert.ok(/^[\x20-\x7E]+$/.test(en["library.savedAsPlaylist"]));
  assert.equal(
    en["queue.saveAsHint"],
    "If a playlist with this name already exists, it will be replaced."
  );
});

test("Add to playlist is still the picker, not this prompt", () => {
  const picker = between(surface, "{addToPlaylistTarget !== null ? (", "{saveAsTarget !== null ? (");
  assert.match(picker, /<PlaylistPickerDialog/);
  assert.ok(!/<PromptDialog/.test(picker));
  assert.match(picker, /playlists\.saveSelection\(name, target\.selection, "append"\)/);
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if the Save as name dialog gains or loses a prop, stops
// pre-filling the tile name, or its three writes stop being create.

test("LOCK Save as name dialog: these props, this name, these three create writes, one prompt", () => {
  const dlg = between(surface, "{saveAsTarget !== null ? (", "{removeTarget !== null ? (");
  const props = [...dlg.matchAll(/^\s{10}(\w+)=/gm)].map((m) => m[1]);
  assert.deepEqual(props, [
    "title",
    "label",
    "initialValue",
    "placeholder",
    "hint",
    "confirmLabel",
    "onCancel",
    "onConfirm"
  ]);
  assert.match(dlg, /initialValue=\{saveAsTarget\.name\}\s*placeholder=\{saveAsTarget\.name\}/);
  assert.match(dlg, /onCancel=\{\(\) => setSaveAsTarget\(null\)\}/);
  assert.match(dlg, /const playlistName = storedPlaylistName\(name\);/);
  assert.match(
    dlg,
    /const created = await playlists\.createPlaylist\(playlistName\);\s*if \(!created\.ok\) return created;\s*return playlists\.addToPlaylist\(playlistName, target\.uris\);/,
    "a file saves as create then add"
  );
  assert.equal((dlg.match(/"create"/g) ?? []).length, 2, "criteria and container both create");
  assert.ok(!/"append"/.test(dlg), "Save as never appends");
  assert.equal((surface.match(/<PromptDialog/g) ?? []).length, 1, "one name prompt on the surface");
  assert.equal((surface.match(/setSaveAsTarget\(\{/g) ?? []).length, 4, "folder, facet, DLNA, file open it - nothing else");
});
