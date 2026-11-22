// Contract (C3): one control, Duplicate, on a stored playlist's card menu.
// The operator types the new name on a dialog; one request -
// playlist.duplicate with the card's name as `source` and the typed name
// as `target`, and nothing else. The same name on both sides is not
// sent. The source stays the one on screen; the control stays available
// on an empty playlist. The plugin's refusal is the answer the operator
// sees. This control never renames, never saves the queue, never names
// a device path, never writes a file.
// Run:
//   node --experimental-strip-types --test tests/contracts/playlist-duplicate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { duplicatePlaylistPayload } from "../../src/features/playlist/playlist-payloads.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "playlist", "usePlaylists.ts"), "utf8");
const surface = readFileSync(join(root, "features", "playlist", "PlaylistsSurface.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the payload is source and target - nothing else", () => {
  const p = duplicatePlaylistPayload("Evening", "Evening copy");
  assert.deepEqual(Object.keys(p), ["source", "target"]);
  assert.deepEqual(p, { source: "Evening", target: "Evening copy" });
  for (const key of ["name", "from_name", "to_name", "path", "overwrite"]) {
    assert.ok(!(key in p), key + " is never sent from the glass");
  }
});

test("the hook sends the one verb once, through the payload helper, and never rename for it", () => {
  assert.ok(/duplicatePlaylist: \(\s*source: string,\s*target: string\s*\) => Promise<PlaylistVerbResult>;/.test(hook), "the hook offers duplicatePlaylist");
  assert.ok(
    /const duplicatePlaylist = useCallback\(\s*\(source: string, target: string\) =>\s*dispatchVoid\("playlist\.duplicate", duplicatePlaylistPayload\(source, target\)\),\s*\[dispatchVoid\]\s*\);/.test(hook),
    "duplicatePlaylist is exactly one dispatchVoid of playlist.duplicate with the helper's payload"
  );
  assert.equal((code(hook).match(/"playlist\.duplicate"/g) ?? []).length, 1, "the verb appears once in the hook");
  assert.ok(!/save_queue_as_playlist|saveAsPlaylist/.test(hook), "the playlist hook never saves the queue");
});

test("the dialog sends duplicate once, refuses the same name, and leaves the source on screen", () => {
  const dialog = between(surface, 'dialog?.kind === "duplicate"', ") : null}");
  assert.ok(/if \(name === dialog\.source\) return;/.test(dialog), "the same name on both sides is not sent");
  assert.equal((dialog.match(/duplicatePlaylist\(/g) ?? []).length, 1, "one send");
  assert.ok(/duplicatePlaylist\(dialog\.source, name\)/.test(dialog), "card name is source, typed name is target");
  assert.ok(!/renamePlaylist|rename_playlist|saveAsPlaylist|save_queue_as_playlist|audioQueue\.|\bloadPlaylist\(|\bappendPlaylist\(|importFile|exportFile|offerDownload|\bpath\b|upload/.test(dialog), "no rename, no queue verb, no device path, no file");
  assert.ok(!/setSelectedName\(/.test(dialog), "the source stays the one on screen");
  assert.ok(/initialValue=\{\}|initialValue=\{""\}/.test(dialog) || !/initialValue=/.test(dialog), "the operator types the new name - not the source pre-filled as the target");
  const opener = between(surface, "const onDuplicatePlaylist = useCallback(", "}, [");
  assert.ok(/setDialog\(\{ kind: "duplicate", source: name \}\)/.test(opener), "the card's name is the source");
  assert.ok(!/duplicatePlaylist\(|renamePlaylist\(/.test(opener), "the opener sends nothing");
});

test("one control, on the card menu, available on an empty playlist", () => {
  assert.equal((surface.match(/onDuplicatePlaylist\(entry\.name\)/g) ?? []).length, 1, "one control, on the stored playlist's card menu");
  const item = between(surface, "onDuplicatePlaylist(entry.name)", "</button>");
  assert.ok(/disabled=\{busy\}/.test(item), "an empty playlist still duplicates");
  assert.ok(/t\("playlist\.duplicate"\)/.test(item), "the control is labelled");
  assert.ok(!/onDuplicatePlaylist\(selectedName/.test(surface), "no second control on the detail header");
  // The label key shares its text with the verb; only t("...") may carry it.
  assert.equal((code(surface).match(/(?<!t\()"playlist\.duplicate"/g) ?? []).length, 0, "the surface goes through the hook");
  assert.ok(!/dispatchVoid\(|pluginRequest\(/.test(surface), "the surface sends no envelope of its own");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["playlist.duplicate", "playlist.duplicateTitle", "playlist.duplicateLabel", "playlist.duplicateAction"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's duplicate payload reads v, source, target", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "playlist_duplicate.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct DuplicatePayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "source", "target"]);
  assert.ok(/payload\.source == payload\.target/.test(s), "the plugin refuses the same name too");
});
