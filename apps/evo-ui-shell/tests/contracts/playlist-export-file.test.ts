// Contract (C2): the operator can download a stored playlist. One control
// on a stored playlist's card menu; one request - playlist.export_file
// with the playlist name and nothing else, so the plugin's default (.m3u)
// applies. The answer's content is offered as a browser download under
// the answer's filename. The glass never calls queue.save_queue_as_playlist
// for this, never asks the device to write a file (no path, no upload),
// and never accepts a .cue answer.
// Run:
//   node --experimental-strip-types --test tests/contracts/playlist-export-file.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeExportReport,
  exportFilePayload
} from "../../src/features/playlist/playlist-export.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "playlist", "usePlaylists.ts"), "utf8");
const surface = readFileSync(join(root, "features", "playlist", "PlaylistsSurface.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "playlist", "playlist-export.ts"), "utf8");
const download = readFileSync(join(root, "features", "playlist", "offer-download.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the payload is the name alone - the plugin's default is .m3u", () => {
  const p = exportFilePayload("Evening");
  assert.deepEqual(Object.keys(p), ["name"]);
  assert.deepEqual(p, { name: "Evening" });
  for (const key of ["format", "absolute", "path"]) {
    assert.ok(!(key in p), key + " is never sent from the glass");
  }
});

test("the answer decodes to filename + content; a cue answer is refused", () => {
  const m3u = decodeExportReport({ v: 1, name: "Evening", format: "m3u", filename: "Evening.m3u", entries: 3, content: "#EXTM3U\n" });
  assert.deepEqual(m3u, { name: "Evening", format: "m3u", filename: "Evening.m3u", entries: 3, content: "#EXTM3U\n" });
  assert.equal(decodeExportReport({ v: 1, name: "E", format: "pls", filename: "E.pls", entries: 0, content: "[playlist]\n" })?.format, "pls");
  assert.equal(decodeExportReport({ v: 1, name: "E", format: "cue", filename: "E.cue", entries: 1, content: "FILE" }), null, "no .cue export");
  assert.equal(decodeExportReport({ v: 1, name: "E", format: "m3u", entries: 1, content: "x" }), null, "no filename, no download");
  assert.equal(decodeExportReport({ v: 1, name: "E", format: "m3u", filename: "E.m3u", entries: 1 }), null, "no content, no download");
  assert.equal(decodeExportReport({ v: 1, name: "E", format: "m3u", filename: "E.m3u", entries: 1, content: "x" })?.filename, "E.m3u");
  assert.equal(decodeExportReport("nope"), null);
});

test("the hook sends the one verb once and decodes the answer", () => {
  assert.ok(/exportFile: \(name: string\) => Promise<PlaylistVerbResult<ExportReport>>;/.test(hook), "the hook offers exportFile");
  const block = between(hook, "const exportFile = useCallback(", "\n  );");
  assert.ok(/pluginRequest\(\s*transport,\s*PLAYLIST_SHELF,\s*"playlist\.export_file",\s*\{ v: PAYLOAD_VERSION, \.\.\.exportFilePayload\(name\) \}\s*\)/.test(block), "one request with the helper's payload");
  assert.ok(/decodeExportReport\(result\.value\)/.test(block), "the answer is decoded, not trusted");
  assert.equal((code(hook).match(/playlist\.export_file/g) ?? []).length, 1, "the verb appears once in the hook");
  assert.ok(!/save_queue_as_playlist|saveAsPlaylist/.test(hook), "the playlist hook never saves the queue");
});

test("the download control exports and offers the answer - nothing else", () => {
  const handler = between(surface, "const onDownloadPlaylist = useCallback(", "}, [");
  assert.ok(/exportFile\(/.test(handler), "the control calls exportFile");
  assert.ok(/offerDownload\(r\.value\.filename, r\.value\.content/.test(handler), "the answer's content goes out under the answer's filename");
  assert.ok(!/saveAsPlaylist|save_queue_as_playlist|audioQueue\.|\bloadPlaylist\(|\bappendPlaylist\(|importFile|\bpath\b|upload/.test(handler), "no queue save, no queue load, no device write");
  assert.ok(!/save_queue_as_playlist|saveAsPlaylist\(/.test(code(surface)), "the playlists surface never calls the queue's save-as");
  assert.ok(/t\("playlist\.download"\)/.test(surface), "the control is labelled");
  assert.equal((surface.match(/onDownloadPlaylist\(entry\.name\)/g) ?? []).length, 1, "one control, on the stored playlist's card menu");
});

test("the download is the browser's, not the device's", () => {
  const d = code(download);
  assert.ok(/URL\.createObjectURL\(/.test(d) && /\.download = filename/.test(d) && /URL\.revokeObjectURL\(/.test(d), "an object URL offered through an anchor, then revoked");
  assert.ok(!/fetch\(|XMLHttpRequest|pluginRequest|transport|writeFile|showSaveFilePicker|FileSystemWritable/.test(d), "nothing sent anywhere, nothing written through a file API");
  assert.ok(!/path|upload|writeFile|showSaveFilePicker/.test(code(helper)), "the export helper names no device path");
  assert.ok(!/"cue"/.test(code(helper).replace(/=== "cue"|!== "cue"/g, "")), "cue is only ever refused");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["playlist.download", "playlist.downloadAction", "playlist.downloadUnusable"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's export payload reads name with format defaulting; there is no cue format; the answer carries filename + content", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "playlist_export.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = (name: string): string[] =>
    [...between(s, `struct ${name} {`, "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields("ExportFilePayload"), ["v", "name", "format", "absolute"]);
  assert.ok(/#\[serde\(default\)\]\s*pub\(crate\) format: ExportFormat/.test(s), "format defaults when omitted");
  assert.ok(/#\[default\]\s*M3u/.test(s), "the default is m3u");
  const variants = between(s, "enum ExportFormat {", "}");
  assert.ok(!/Cue/.test(variants), "no cue export on the plugin");
  const report = fields("ExportReport");
  assert.ok(report.includes("filename") && report.includes("content"), "the answer carries filename and content");
});
