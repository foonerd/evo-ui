// Contract: every browse kebab paints the same six verbs, in
// this order. Coverage went random when each surface authored
// its own list.
//
// Play now / Play next / Add to queue / Clear and play /
// Add to playlist / Save as playlist. Play now appends and
// plays (live queue kept). Clear and play is queue-scope
// replace (file: audioQueue.playNow; folder/facet:
// enqueue_selection replace). Artist / album still append
// Refresh image / Clear cached image after a divider; those
// two rows are not restyled. Genre / year have no artwork
// rows. Queue / Favourites / Sources kebabs are not browse.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(join(here, "..", "..", "src", rel), "utf8");

const builder = src("features/library/browse-kebab.tsx");
const facet = src("features/library/FacetTile.tsx");
const surface = src("features/library/LibrarySurface.tsx");
const queueHook = src("features/queue/useAudioQueue.ts");
const favourites = src("features/favourites/FavouritesSurface.tsx");
const queueSurface = src("features/queue/QueueSurface.tsx");
const sources = src("features/sources/SourcesSurface.tsx");

const REQUIRED_IDS = [
  "play-now",
  "play-next",
  "add-queue",
  "clear-and-play",
  "add-to-playlist",
  "save-playlist"
];

const idsIn = (s: string): string[] =>
  [...s.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);

test("the shared builder is the six verbs, in that order", () => {
  assert.deepEqual(idsIn(builder), REQUIRED_IDS);
  assert.match(builder, /label: t\("collection\.playNow"\)/);
  assert.match(builder, /onSelect: \(\) => handlers\.onQueue\("now"\)/);
  assert.match(builder, /label: t\("collection\.playNext"\)/);
  assert.match(builder, /onSelect: \(\) => handlers\.onQueue\("next"\)/);
  assert.match(builder, /label: t\("collection\.addToQueue"\)/);
  assert.match(builder, /onSelect: \(\) => handlers\.onQueue\("append"\)/);
  assert.match(builder, /label: t\("collection\.clearAndPlay"\)/);
  assert.match(builder, /onSelect: \(\) => handlers\.onQueue\("replace"\)/);
  assert.match(builder, /label: t\("collection\.addToPlaylist"\)/);
  assert.match(builder, /onSelect: handlers\.onAddToPlaylist/);
  assert.match(builder, /label: t\("collection\.saveAsPlaylist"\)/);
  assert.match(builder, /onSelect: handlers\.onSave/);
  assert.equal(en["collection.clearAndPlay"], "Clear and play");
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.clearAndPlay"]));
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.playNow"]));
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.addToPlaylist"]));
  assert.ok(/^[\x20-\x7E]+$/.test(en["collection.saveAsPlaylist"]));
});

test("a partial handler set paints no kebab", () => {
  const fn = builder.slice(builder.indexOf("export function browseQueueKebabItems"));
  assert.match(fn, /onQueue[\s\S]*onAddToPlaylist[\s\S]*onSave/);
  const gate = facet.slice(facet.indexOf("function queueItems("), facet.indexOf("export function FacetTile"));
  assert.match(gate, /onQueue === undefined/);
  assert.match(gate, /onSave === undefined/);
  assert.match(gate, /onAddToPlaylist === undefined/);
  assert.match(gate, /return \[\];/);
  assert.match(gate, /return browseQueueKebabItems/);
});

test("every Folder / Artist / Album / Genre / Year / file kebab uses the builder", () => {
  assert.equal(
    (surface.match(/browseQueueKebabItems\(/g) ?? []).length,
    2,
    "file tile + folder tile"
  );
  assert.match(facet, /browseQueueKebabItems\(\{ onQueue, onSave, onAddToPlaylist \}\)/);
  assert.match(surface, /<FacetTile[\s\S]*onAddToPlaylist=\{\(\) =>/);
  assert.match(surface, /onFacetAddToPlaylist\(/);
  assert.ok(!favourites.includes("browseQueueKebabItems"), "favourites is not browse");
  assert.ok(!queueSurface.includes("browseQueueKebabItems"), "queue is not browse");
  assert.ok(!sources.includes("browseQueueKebabItems"), "sources is not browse");
});

test("artist and album keep Refresh image / Clear cached image after a divider", () => {
  const cover = facet.slice(facet.indexOf("// Kebab: universal queue actions"));
  assert.match(cover, /\.\.\.queueItems\(onQueue, onSave, onAddToPlaylist\)/);
  const after = cover.slice(cover.indexOf("...queueItems"));
  const artIds = idsIn(after);
  assert.deepEqual(artIds, ["refresh", "clear"]);
  assert.match(after, /id: "refresh"[\s\S]*separatorBefore: true[\s\S]*onSelect: refresh/);
  assert.match(after, /label: t\("artwork\.tile\.refresh"\)/);
  assert.match(after, /label: t\("artwork\.tile\.clear"\)/);
  assert.match(after, /onSelect: clear/);
  assert.match(facet, /verb: "artwork\.online\.clear_cache"/);
  assert.match(facet, /scheme: "artist-name"/);
  assert.match(facet, /verb: "artwork\.local\.clear_cache"/);
  assert.match(facet, /scheme: "mpd-album"/);
  assert.match(facet, /const r = await clearArtwork\(clearTarget\.target\);/);
  assert.match(facet, /if \(r\.ok\) setCleared\(true\);/);
  assert.equal(en["artwork.tile.refresh"], "Refresh image");
  assert.equal(en["artwork.tile.clear"], "Clear cached image");
});

test("genre and year kebabs have no artwork rows", () => {
  const label = facet.slice(
    facet.indexOf("// Genre / year:"),
    facet.indexOf("function CoverFacetTile")
  );
  assert.match(label, /const items = queueItems\(props\.onQueue, props\.onSave, props\.onAddToPlaylist\)/);
  assert.ok(!/id: "refresh"/.test(label));
  assert.ok(!/id: "clear"/.test(label));
  assert.ok(!/artwork\.tile/.test(label));
});

test("Play now keeps the queue; Clear and play replaces it", () => {
  assert.match(surface, /audioQueue\.appendAndPlay\(\[entry\.uri\]\)/);
  assert.match(surface, /audioQueue\.playNow\(\[entry\.uri\]\)/);
  assert.match(surface, /mode === "now"\s*\? audioQueue\.appendAndPlaySelection\(selection\)/);
  assert.match(surface, /audioQueue\.enqueueSelection\(selection, toVerbMode\(mode\)\)/);
  assert.match(surface, /mode === "now"\s*\? audioQueue\.appendAndPlayContainer/);
  const toVerb = surface.slice(
    surface.indexOf("const toVerbMode"),
    surface.indexOf("type BrowsePlaylistTarget")
  );
  assert.match(toVerb, /m === "replace" \? "replace" : m/);
  assert.ok(!/m === "now" \? "replace"/.test(toVerb), "now is no longer silently replace");

  const playNowStart = queueHook.indexOf("const playNow = useCallback(");
  assert.ok(playNowStart >= 0);
  const playNowEnd = queueHook.indexOf("[dispatch]\n  );", playNowStart);
  assert.ok(playNowEnd > playNowStart);
  const playNow = queueHook.slice(playNowStart, playNowEnd);
  const order = ["queue.clear_queue", "queue.enqueue", "queue.play_from_position"].map(
    (v) => playNow.indexOf(v)
  );
  assert.ok(
    order[0]! >= 0 && order[0]! < order[1]! && order[1]! < order[2]!,
    "Clear and play on a file is still clear, enqueue, play from 0"
  );

  const append = queueHook.slice(queueHook.indexOf("const appendAndPlay = useCallback("));
  assert.match(append, /const start = current\.length;/);
  assert.match(append, /const added = await enqueue\(uris\);/);
  assert.match(append, /return playFromPosition\(start\);/);
  assert.ok(!/clear_queue/.test(append.slice(0, append.indexOf("const appendAndPlaySelection"))));
});

test("Add to playlist on a folder or facet is save_selection append, not a URI list", () => {
  const picker = surface.slice(surface.indexOf("{addToPlaylistTarget !== null ? ("));
  assert.match(picker, /target\.kind === "uris"/);
  assert.match(picker, /playlists\.addToPlaylist\(name, target\.uris\)/);
  assert.match(picker, /target\.kind === "criteria"/);
  assert.match(picker, /playlists\.saveSelection\(name, target\.selection, "append"\)/);
  assert.match(picker, /playlists\.saveSelectionContainer\(/);
  assert.match(surface, /kind: "criteria"/);
  assert.match(surface, /dimension: "folder"/);
});

// ---- standing-neighbour lock ------------------------------------------
// Goes red if the six verbs, their order, their labels, or the one
// builder that every browse tile uses moves.

test("LOCK browse kebab: six verbs, this order, these labels, one builder on every browse tile", () => {
  assert.deepEqual(idsIn(builder), [
    "play-now",
    "play-next",
    "add-queue",
    "clear-and-play",
    "add-to-playlist",
    "save-playlist"
  ]);
  assert.equal((builder.match(/id: "/g) ?? []).length, 6, "no seventh verb, none dropped");
  assert.deepEqual(
    [
      en["collection.playNow"],
      en["collection.playNext"],
      en["collection.addToQueue"],
      en["collection.clearAndPlay"],
      en["collection.addToPlaylist"],
      en["collection.saveAsPlaylist"]
    ],
    ["Play now", "Play next", "Add to queue", "Clear and play", "Add to playlist", "Save as playlist"]
  );
  const fileTile = surface.slice(
    surface.indexOf("const renderFileTile = (entry: LibraryEntry) => {"),
    surface.indexOf("// ----- render ---")
  );
  assert.ok(fileTile.length > 0);
  assert.ok(!/id: "play-|id: "add-|id: "clear-|id: "save-/.test(fileTile), "the file kebab authors no verb of its own");
  assert.equal((surface.match(/browseQueueKebabItems\(/g) ?? []).length, 2, "file tile + folder tile");
  assert.equal((facet.match(/browseQueueKebabItems\(/g) ?? []).length, 1, "every facet through the one gate");
  assert.equal((builder.match(/export function browseQueueKebabItems/g) ?? []).length, 1, "one builder");
});

