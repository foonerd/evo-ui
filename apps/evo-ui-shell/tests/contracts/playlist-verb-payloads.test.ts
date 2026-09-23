// Contract: the playlist add / remove / move verbs send the fields the
// plugin's payload structs read.
//
// playlist.add_to_playlist reads { name, uris }; remove_from_playlist
// reads { name, positions: [u32] }; move_in_playlist reads { name,
// from_position, to_position }. A missing field is a Permanent parse
// refusal (400), so the wrong key is the whole failure. create / delete
// / rename keep their payloads; save_selection keeps playlist_name,
// which is that verb's own field; dispatchVoid still wraps { v: 1 }.
// The library kebab, the queue, favourites and the pivot all go through
// these helpers, so the helpers are fixed, not the call sites.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  addToPlaylistPayload,
  moveInPlaylistPayload,
  removeFromPlaylistPayload
} from "../../src/features/playlist/playlist-payloads.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/playlist/usePlaylists.ts");
const payloads = src("features/playlist/playlist-payloads.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

// ---- the encoded payloads ---------------------------------------------

test("add_to_playlist encodes { name, uris } and nothing else", () => {
  const p = addToPlaylistPayload("Evening", ["local:/a.flac", "local:/b.flac"]);
  assert.equal(JSON.stringify(p), '{"name":"Evening","uris":["local:/a.flac","local:/b.flac"]}');
  assert.deepEqual(Object.keys(p), ["name", "uris"]);
  assert.ok(!("playlist_name" in p));
});

test("remove_from_playlist encodes { name, positions: [position] } - one u32 in an array", () => {
  const p = removeFromPlaylistPayload("Evening", 3);
  assert.equal(JSON.stringify(p), '{"name":"Evening","positions":[3]}');
  assert.deepEqual(Object.keys(p), ["name", "positions"]);
  assert.ok(!("position" in p) && !("playlist_name" in p));
  assert.equal(JSON.stringify(removeFromPlaylistPayload("Evening", 0)), '{"name":"Evening","positions":[0]}');
});

test("move_in_playlist encodes { name, from_position, to_position }", () => {
  const p = moveInPlaylistPayload("Evening", 2, 5);
  assert.equal(JSON.stringify(p), '{"name":"Evening","from_position":2,"to_position":5}');
  assert.deepEqual(Object.keys(p), ["name", "from_position", "to_position"]);
  assert.ok(!("playlist_name" in p));
});

test("the payload module is pure: no hook, no transport, no i18n", () => {
  assert.ok(!/from "preact|useCallback|WsTransport|pluginRequest|i18n/.test(payloads));
  assert.ok(/^[\x20-\x7E\n]+$/.test(payloads), "7-bit");
});

// ---- the hook sends exactly those --------------------------------------

test("addToPlaylist / removeFromPlaylist / moveInPlaylist dispatch the encoded payloads through dispatchVoid", () => {
  const add = between(hook, "const addToPlaylist = useCallback(", "const saveSelection = useCallback(");
  assert.match(add, /dispatchVoid\("playlist\.add_to_playlist", addToPlaylistPayload\(playlistName, uris\)\)/);
  const remove = between(hook, "const removeFromPlaylist = useCallback(", "const moveInPlaylist = useCallback(");
  assert.match(remove, /dispatchVoid\(\s*"playlist\.remove_from_playlist",\s*removeFromPlaylistPayload\(playlistName, position\)\s*\)/);
  const move = between(hook, "const moveInPlaylist = useCallback(", "return {");
  assert.match(move, /dispatchVoid\(\s*"playlist\.move_in_playlist",\s*moveInPlaylistPayload\(playlistName, fromPosition, toPosition\)\s*\)/);
  for (const [label, body] of [["add", add], ["remove", remove], ["move", move]] as const) {
    assert.ok(!/playlist_name/.test(body), `${label} no longer sends playlist_name`);
    assert.ok(!/\bposition\b\s*[,}]/.test(body), `${label} sends no bare position`);
  }
  assert.match(hook, /from "\.\/playlist-payloads"/);
});

test("create / delete / rename payloads and save_selection are untouched; dispatchVoid still wraps v", () => {
  assert.match(hook, /dispatchVoid\("playlist\.create_playlist", \{ name \}\)/);
  assert.match(hook, /dispatchVoid\("playlist\.delete_playlist", \{ name \}\)/);
  assert.match(hook, /dispatchVoid\("playlist\.rename_playlist", \{\s*from_name: fromName,\s*to_name: toName\s*\}\)/);
  const save = between(hook, "const saveSelection = useCallback(", "const removeFromPlaylist = useCallback(");
  assert.equal((save.match(/playlist_name: playlistName/g) ?? []).length, 2, "save_selection (criteria + container) keep playlist_name");
  assert.match(hook, /\{ v: PAYLOAD_VERSION, \.\.\.envelope \}/);
  const hookCode = hook.replace(/^\s*\/\/[^\n]*$/gm, "");
  assert.equal((hookCode.match(/playlist_name/g) ?? []).length, 2, "playlist_name lives only on save_selection");
});

test("the four verbs are sent from the helpers only - no call site builds its own payload", () => {
  const surfaces = [
    "features/library/LibrarySurface.tsx",
    "features/playlist/PlaylistsSurface.tsx",
    "features/queue/QueueSurface.tsx",
    "features/queue/PivotQueueReveal.tsx",
    "features/pivot/PivotArtReveal.tsx",
    "features/favourites/FavouritesSurface.tsx",
    "features/playback/PlaybackSurface.tsx"
  ];
  for (const rel of surfaces) {
    const s = src(rel);
    assert.match(s, /\b(addToPlaylist|removeFromPlaylist|moveInPlaylist)\(/, `${rel} uses a helper`);
    assert.ok(!/"playlist\.(add_to_playlist|remove_from_playlist|move_in_playlist)"/.test(s.replace(/\/\/[^\n]*/g, "")), `${rel} goes through the hook`);
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's payload structs read exactly these fields", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "playlist.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = (name: string): string[] =>
    [...between(s, `struct ${name} {`, "}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields("AddToPlaylistPayload"), ["v", "name", "uris"]);
  assert.deepEqual(fields("RemoveFromPlaylistPayload"), ["v", "name", "positions"]);
  assert.deepEqual(fields("MoveInPlaylistPayload"), ["v", "name", "from_position", "to_position"]);
  assert.ok(fields("SaveSelectionPayload").includes("playlist_name"));
  assert.ok(!/serde\(alias/.test(between(s, "struct AddToPlaylistPayload {", "struct SimplePlaylistResponse")), "no alias hides a wrong field");
});
