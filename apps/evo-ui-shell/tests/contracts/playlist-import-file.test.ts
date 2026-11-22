// Contract (C1): the operator can import a playlist file. One control on
// the Playlists landing; one write - playlist.import_file with the file's
// text in `content`, the playlist `name`, and the `format` the file's
// extension says (m3u / pls / cue). The glass reads the file itself; it
// never sends `path`, never writes a file anywhere, never exports, and
// never loads the imported playlist onto the queue.
// Run:
//   node --experimental-strip-types --test tests/contracts/playlist-import-file.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  importFilePayload,
  importFormatFromFileName,
  playlistNameFromFileName
} from "../../src/features/playlist/playlist-import.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "playlist", "usePlaylists.ts"), "utf8");
const surface = readFileSync(join(root, "features", "playlist", "PlaylistsSurface.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "playlist", "playlist-import.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the payload is name, format, content - nothing else", () => {
  const p = importFilePayload("Evening", "m3u", "#EXTM3U\nsongs/one.flac\n");
  assert.deepEqual(Object.keys(p), ["name", "format", "content"]);
  assert.deepEqual(p, { name: "Evening", format: "m3u", content: "#EXTM3U\nsongs/one.flac\n" });
  for (const key of ["path", "base", "overwrite"]) {
    assert.ok(!(key in p), key + " is never sent from the glass");
  }
});

test("the format comes from the file's extension; the name is the file name without it", () => {
  assert.equal(importFormatFromFileName("a.m3u"), "m3u");
  assert.equal(importFormatFromFileName("a.M3U8"), "m3u");
  assert.equal(importFormatFromFileName("a.pls"), "pls");
  assert.equal(importFormatFromFileName("a.cue"), "cue");
  assert.equal(importFormatFromFileName("a.txt"), null);
  assert.equal(importFormatFromFileName("m3u"), null);
  assert.equal(playlistNameFromFileName("Friday evening.m3u"), "Friday evening");
  assert.equal(playlistNameFromFileName("set.2024.pls"), "set.2024");
  assert.equal(playlistNameFromFileName("disc one.cue"), "disc one");
});

test("the hook sends the one verb once, through the payload helper", () => {
  assert.ok(/importFile: \(\s*name: string,\s*format: ImportFormat,\s*content: string\s*\) => Promise<PlaylistVerbResult>;/.test(hook), "the hook offers importFile");
  assert.ok(
    /const importFile = useCallback\(\s*\(name: string, format: ImportFormat, content: string\) =>\s*dispatchVoid\("playlist\.import_file", importFilePayload\(name, format, content\)\),\s*\[dispatchVoid\]\s*\);/.test(hook),
    "importFile is exactly one dispatchVoid of playlist.import_file with the helper's payload"
  );
  assert.equal((code(hook).match(/playlist\.import_file/g) ?? []).length, 1, "the verb appears once in the hook");
  assert.ok(!/load_playlist_to_queue/.test(hook), "the playlist hook never loads the queue");
});

test("the import control sends the import and nothing after it - no queue load", () => {
  const handler = between(surface, "const onImportFile = useCallback(", "}, [");
  assert.ok(/importFile\(/.test(handler), "the control calls importFile");
  assert.ok(!/loadPlaylist|appendPlaylist|load_playlist_to_queue|playFromPosition|enqueue|audioQueue\./.test(handler), "no queue verb after the import");
  assert.ok(!/setSelectedName\(/.test(handler), "the control does not drill in - no read after the write");
  for (const m of surface.matchAll(/importFile\(/g)) {
    const tail = surface.slice(m.index, (m.index ?? 0) + 240);
    assert.ok(!/loadPlaylist|appendPlaylist|playFromPosition/.test(tail), "import is not followed by a queue verb");
  }
  assert.ok(/accept="\.m3u,\.m3u8,\.pls,\.cue"/.test(surface), "the picker offers the three formats");
  assert.ok(/t\("playlist\.import"\)/.test(surface), "the control is labelled");
});

test("the import writes no file - no download, no save picker, no .cue beside music; the import path exports nothing", () => {
  for (const [name, s] of [["surface", surface], ["helper", helper], ["hook", hook]] as const) {
    const c = code(s);
    assert.ok(!/createObjectURL|showSaveFilePicker|download=|new Blob\(|writeFile|FileSystemWritable/.test(c), name + " writes no file");
  }
  // The export verb is its own control (playlist-export-file.test.ts);
  // the import handler and the import helper never reach it.
  const handler = between(surface, "const onImportFile = useCallback(", "}, [");
  for (const [name, c] of [["import handler", handler], ["import helper", code(helper)]] as const) {
    assert.ok(!/"playlist\.export|export_file|export_playlist|exportFile|offerDownload/.test(c), name + " does not export");
  }
});

test("the strings exist and are ASCII", () => {
  for (const key of ["playlist.import", "playlist.importAction", "playlist.importHelp", "playlist.importUnknownFormat"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's import payload reads these fields and the format tokens are lowercase", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "playlist_import.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct ImportFilePayload {", "}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  for (const f of ["v", "name", "format", "content"]) {
    assert.ok(fields.includes(f), "plugin reads " + f);
  }
  assert.ok(/#\[serde\(rename_all = "lowercase"\)\]\s*pub\(crate\) enum ImportFormat/.test(s), "format tokens are m3u / pls / cue");
});
