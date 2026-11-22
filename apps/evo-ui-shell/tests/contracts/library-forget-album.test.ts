// Contract (E2): one control, Forget album, on an album tile. A file keeps
// the track control it already has; an artist, a genre and a year tile
// have no such control. It is not one of the six queue actions in the
// browse kebab, and that list stays as it is. The operator confirms;
// Cancel sends nothing; Confirm is one request, library.forget_album.
// `album` is the tile's album_id when the browse answer carries it, else
// the display title; when the title is sent and the tile has an artist,
// `parent` is { tag: "artist", value: that artist }. No other key. The
// hook adds v. The decoder keeps album_id. After the answer the tile
// leaves the album list and an open drill of that album drops its tracks;
// there is no second read.
// Run:
//   node --experimental-strip-types --test tests/contracts/library-forget-album.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forgetAlbumPayload, withoutAlbum } from "../../src/features/library/forget-album.ts";
import { decodeFacetBrowse } from "../../src/features/library/library-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "library", "useLibrary.ts"), "utf8");
const surface = readFileSync(join(root, "features", "library", "LibrarySurface.tsx"), "utf8");
const tile = readFileSync(join(root, "features", "library", "FacetTile.tsx"), "utf8");
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

test("the payload is album, or album + parent artist - no other key", () => {
  const byId = forgetAlbumPayload({ value: "Low Trust", albumId: "INTERNAL/Low/Trust", artist: "Someone" });
  assert.deepEqual(byId, { album: "INTERNAL/Low/Trust" });
  assert.deepEqual(Object.keys(byId), ["album"]);
  const byTitle = forgetAlbumPayload({ value: "Low Trust", albumId: null, artist: "Someone" });
  assert.deepEqual(byTitle, { album: "Low Trust", parent: { tag: "artist", value: "Someone" } });
  assert.deepEqual(Object.keys(byTitle), ["album", "parent"]);
  assert.deepEqual(Object.keys(byTitle.parent ?? {}), ["tag", "value"]);
  const bare = forgetAlbumPayload({ value: "Low Trust", albumId: null, artist: null });
  assert.deepEqual(bare, { album: "Low Trust" });
  assert.deepEqual(forgetAlbumPayload({ value: "Low Trust", albumId: "", artist: "Someone" }), { album: "Low Trust", parent: { tag: "artist", value: "Someone" } }, "an empty id is no id");
  for (const key of ["source_id", "uri", "uris", "value", "select", "path"]) {
    assert.ok(!(key in byId) && !(key in byTitle), key + " is never sent from the glass");
  }
});

test("the drop takes one album out of an album list - by id when both carry one, else by title + artist", () => {
  const e = (value: string, albumId: string | null, artist: string | null) =>
    ({ value, albumId, artist, coverUrl: null, trackCount: 1 });
  const list = [e("Low Trust", "A/Low", "One"), e("Low Trust", "B/Low", "Two"), e("Other", null, "One"), e("Low Trust", null, "Three")];
  assert.deepEqual(withoutAlbum(list, e("Low Trust", "A/Low", "One")).map((x) => x.albumId ?? x.artist), ["B/Low", "One", "Three"], "by id: the same-titled album of another artist stays");
  assert.deepEqual(withoutAlbum(list, e("Low Trust", null, "Three")).map((x) => x.albumId ?? x.artist), ["A/Low", "B/Low", "One"], "by title + artist");
  assert.deepEqual(withoutAlbum(list, e("Nope", null, null)), list, "nothing matching, nothing dropped");
  assert.deepEqual(withoutAlbum([], e("Low Trust", "A/Low", "One")), []);
});

test("the decoder keeps album_id; other facets carry none", () => {
  const albums = decodeFacetBrowse({ v: 1, facet: "album", entries: [
    { album: "Low Trust", album_id: "INTERNAL/Low/Trust", artist: "Someone", cover_url: null, track_count: 9 },
    { album: "Untagged", artist: null, cover_url: null, track_count: 1 }
  ] }, "album");
  assert.ok(albums !== null);
  assert.equal(albums.entries[0]?.albumId, "INTERNAL/Low/Trust");
  assert.equal(albums.entries[1]?.albumId, null);
  const artists = decodeFacetBrowse({ v: 1, facet: "artist", entries: [{ artist: "Someone", album_id: "stray" }] }, "artist");
  assert.ok(artists !== null);
  assert.equal(artists.entries[0]?.albumId, null, "album_id is an album's key");
});

test("the hook sends the one verb once, through the payload helper", () => {
  assert.ok(/forgetAlbum: \(\s*entry: Pick<FacetEntry, "value" \| "albumId" \| "artist">\s*\) => Promise<LibraryVerbResult>;/.test(hook), "the hook offers forgetAlbum");
  assert.ok(
    /const forgetAlbum = useCallback\(\s*\(entry: Pick<FacetEntry, "value" \| "albumId" \| "artist">\) =>\s*dispatch\("library\.forget_album", forgetAlbumPayload\(entry\)\),\s*\[dispatch\]\s*\)/.test(hook),
    "forgetAlbum is exactly one dispatch of library.forget_album with the helper's payload"
  );
  assert.equal((code(hook).match(/library\.forget_album/g) ?? []).length, 1, "the verb appears once in the hook");
  assert.equal((code(hook).match(/library\.forget_track/g) ?? []).length, 1, "the file verb is untouched");
});

test("the six kebab ids stay the six ids and Forget album is not among them", () => {
  const ids = [...between(kebab, "export const BROWSE_KEBAB_QUEUE_IDS = [", "] as const").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["play-now", "play-next", "add-queue", "clear-and-play", "add-to-playlist", "save-playlist"]);
  assert.ok(!/forget/i.test(code(kebab)), "the browse kebab does not carry Forget");
  const items = between(tile, "const items: KebabMenuItem[] = [", "];");
  assert.ok(!/forget/i.test(items), "the cover tile's kebab does not carry Forget either");
});

test("only the album tile carries the control; artist, genre and year do not; the file keeps its own", () => {
  assert.ok(/onForget\?: \(\) => void;/.test(tile), "the tile offers an optional Forget");
  const artist = between(tile, 'if (facet === "artist") {', "}\n  if");
  assert.ok(!/onForget/.test(artist), "an artist tile has no Forget");
  const album = between(tile, 'if (facet === "album") {', "\n  }\n");
  assert.ok(/onForget=\{props\.onForget\}/.test(album), "the album tile carries Forget");
  const abstract = tile.slice(tile.indexOf("// Genre / year:"), tile.indexOf("function CoverFacetTile("));
  assert.ok(!/onForget/.test(abstract), "genre and year tiles have no Forget");
  const cover = tile.slice(tile.indexOf("function CoverFacetTile("));
  assert.ok(/onForget !== undefined \? \(/.test(cover), "the cover tile paints the control only when given it");
  assert.ok(/t\("library\.forgetAlbum"\)/.test(cover), "labelled");
  const facetTile = between(surface, "<FacetTile", "/>");
  assert.ok(/onForget=\{\s*browseMode === "album"\s*\? \(\) => onForgetAlbum\(entry\)\s*: undefined\s*\}/.test(facetTile), "the surface hands Forget to album tiles only");
  const fileTile = between(surface, "const renderFileTile = (entry: LibraryEntry) => {", "// ----- render");
  assert.ok(/onForgetFile\(entry\)/.test(fileTile) && !/onForgetAlbum|forgetAlbum/.test(fileTile), "the file keeps its track control and never sends the album verb");
});

test("the operator confirms; cancel sends nothing; confirm is one request; the tile and the open drill drop with no second read", () => {
  const opener = between(surface, "const onForgetAlbum = useCallback(", "}, [");
  assert.ok(/setForgetAlbumTarget\(\{ entry, sourceId: selectedSource \}\)/.test(opener) && !/forgetAlbum\(|forgetTrack\(|removeSource\(/.test(opener), "the opener asks; it does not send");
  const dialog = between(surface, "{forgetAlbumTarget !== null ? (", ") : null}");
  assert.ok(/<ConfirmDialog/.test(dialog), "a confirm dialog");
  assert.ok(/onCancel=\{\(\) => setForgetAlbumTarget\(null\)\}/.test(dialog), "cancel closes and sends nothing");
  assert.equal((dialog.match(/forgetAlbum\(/g) ?? []).length, 1, "confirm is one request");
  assert.ok(/library\.forgetAlbum\(target\.entry\)/.test(dialog), "the tile's identity goes as it was decoded");
  assert.ok(/dropForgottenAlbum\(target\)/.test(dialog), "the tile and the drill drop");
  assert.ok(!/removeSource|remove_source|forgetTrack\(|loadFacet\(|browseSource\(|browse\(|drillDimension\(|openDrill\(|searchLibrary\(|refresh/i.test(dialog), "no other verb, no second read");
  const drop = between(surface, "const dropForgottenAlbum = useCallback(", "}, [");
  // The album cache is written from the album cache - never from whatever
  // list is on screen. The operator may have left Albums while the dialog
  // was open; the confirm still forgets the album and must not store the
  // Artists / Genres / Years list under the album key.
  assert.ok(/const key = `\$\{target\.sourceId\}:album`;/.test(drop), "the album cache of the source the tile came from");
  assert.ok(/const cached = FACET_CACHE\.get\(key\);/.test(drop), "read the album cache");
  assert.ok(/FACET_CACHE\.set\(key, \{ \.\.\.cached, entries: withoutAlbum\(cached\.entries, target\.entry\) \}\)/.test(drop), "write the album cache only from the album cache");
  assert.equal((drop.match(/FACET_CACHE\.set\(/g) ?? []).length, 1, "one cache write, and not inside setFacetState");
  assert.ok(!/setFacetState\([\s\S]*FACET_CACHE/.test(drop), "the on-screen list never feeds the cache");
  assert.ok(/if \(browseMode === "album" && selectedSource === target\.sourceId\) \{\s*setFacetState\(\(cur\) =>\s*cur === null \? cur : \{ \.\.\.cur, entries: withoutAlbum\(cur\.entries, target\.entry\) \}\s*\);/.test(drop), "the on-screen list is filtered only when it is that source's album list");
  assert.ok(/drill\?\.facet === "album" && drill\.value === target\.entry\.value/.test(drop) && /setDrillTracks\(\[\]\)/.test(drop), "an open drill of that album drops its tracks");
  assert.ok(!/loadFacet\(|browse\(|drillDimension\(|dispatch|pluginRequest/.test(drop), "a filter, not a read");
  const opener2 = between(surface, "const onForgetAlbum = useCallback(", "}, [");
  assert.ok(/setForgetAlbumTarget\(\{ entry, sourceId: selectedSource \}\)/.test(opener2), "the dialog remembers which source's album list the tile came from");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["library.forgetAlbum", "library.forgetAlbumTitle", "library.forgetAlbumMessage", "library.forgetAlbumAction"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's forget_album payload reads v, album, parent?; its album tiles carry album_id", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.playback.mpd", "src", "library.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const fields = [...between(s, "struct ForgetAlbumPayload {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(fields, ["v", "album", "parent"]);
  const parent = [...between(s, "struct BrowseSelectorParent {", "\n}").matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1] ?? "");
  assert.deepEqual(parent, ["tag", "value"]);
  assert.ok(/"album_id":\s*tile\.canonical_folder/.test(s), "album tiles carry album_id");
  assert.ok(/t\.canonical_folder == selector_value\s*\|\|\s*t\.display_title\.eq_ignore_ascii_case\(selector_value\)/.test(s), "the id or the title resolves the album");
});
