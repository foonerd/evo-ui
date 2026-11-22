// Contract: list tiles paint the scan-time artwork hash, and hear landings.
//
// The library scan finds each album's local art once and carries its
// content hash as an optional `artwork_hash` on queue, favourites and
// playlist rows, on album facet tiles and on file rows (browse, drill,
// search). `GET /api/v1/audio/artwork/<hash>` serves those bytes as
// immutable. The hash is of the `small` art.
//
//  - Each decoder keeps `artworkHash`: a 64-lowercase-hex value, or null.
//  - One rule picks the address a tile paints: the hash address only
//    when the tile would paint the `small` art; any other size (the
//    operator's medium / original on facet tiles) keeps the sized resolve
//    address. No address when the surface paints none. A hash address
//    never carries a size or a cache-bust.
//  - An album with no local art keeps its resolve address. Its art may
//    land later from the background enrichment (artwork_resolved): one
//    subscription, mounted once in the shell, so Queue / Favourites /
//    Playlists hear it as well as Library. A tile painting a resolve
//    address re-requests it on its own landing; a tile painting a hash
//    address never re-requests.
//  - The album facet tile keeps Refresh and Clear exactly as before: once
//    refreshed or after a landing it paints the resolve address again.
//  - now_playing art (stage, pivot) is not touched: it carries no hash.
// Run:
//   node --experimental-strip-types --test tests/contracts/artwork-hash-consumer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeQueueItem } from "../../src/features/queue/audio-queue-decoders.ts";
import { decodeFavouriteItem } from "../../src/features/favourites/favourites-decoders.ts";
import { decodePlaylistItem } from "../../src/features/playlist/playlist-decoders.ts";
import { decodeLibraryEntry, decodeFacetBrowse } from "../../src/features/library/library-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const helperPath = join(root, "features", "library", "artwork-src.ts");
const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  assert.ok(a >= 0, "missing " + from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(b > a, "missing " + to);
  return s.slice(a, b);
}

async function helper(): Promise<typeof import("../../src/features/library/artwork-src.ts")> {
  assert.ok(existsSync(helperPath), "features/library/artwork-src.ts exists");
  return await import("../../src/features/library/artwork-src.ts");
}

const HASH = "327f73c693e04aeba3ebadd02c0a20edd265bac8861a3876c1f9ce4047a55f6e";
const SMALL = "/api/v1/audio/artwork?scheme=mpd-album&value=Adele%7C25&size=small";
const MEDIUM = "/api/v1/audio/artwork?scheme=mpd-path&value=INTERNAL%2FAdele%2F25%2F01.mp3&size=medium";

// ---- decoders ---------------------------------------------------------------

test("every list decoder keeps a 64-hex artwork_hash, and null for anything else", () => {
  const bad = [undefined, "", "ABC", HASH.toUpperCase(), HASH.slice(1), HASH + "0", 7, null];
  const cases: Array<[string, (raw: Record<string, unknown>) => { artworkHash?: unknown } | null, Record<string, unknown>]> = [
    ["queue", (r) => decodeQueueItem(r), { id: 1, position: 0, uri: "a.mp3", artwork_url: SMALL }],
    ["favourites", (r) => decodeFavouriteItem(r), { uri: "a.mp3", position: 0, artwork_url: SMALL }],
    ["playlist", (r) => decodePlaylistItem(r), { uri: "a.mp3", position: 0, artwork_url: SMALL }],
    ["file row", (r) => decodeLibraryEntry(r), { kind: "file", name: "a.mp3", uri: "a.mp3", artwork_url: SMALL }]
  ];
  for (const [name, decode, base] of cases) {
    assert.equal(decode({ ...base, artwork_hash: HASH })?.artworkHash, HASH, name + " keeps the hash");
    for (const b of bad) {
      const raw = b === undefined ? { ...base } : { ...base, artwork_hash: b };
      assert.equal(decode(raw)?.artworkHash, null, `${name}: ${JSON.stringify(b)} is no hash`);
    }
  }
  const facet = decodeFacetBrowse({ entries: [
    { album: "25", artist: "Adele", cover_url: SMALL, track_count: 11, album_id: "INTERNAL/Adele/25", artwork_hash: HASH },
    { album: "21", artist: "Adele", cover_url: SMALL, track_count: 11, album_id: "INTERNAL/Adele/21" }
  ] }, "album");
  assert.deepEqual(facet?.entries.map((e) => (e as { artworkHash?: unknown }).artworkHash), [HASH, null], "album facet tiles keep the hash");
});

// ---- the one rule -------------------------------------------------------------

test("the hash address only when the tile would paint the small art", async () => {
  const { artworkSrc, artworkHashUrl, HASHED_SIZE } = await helper();
  assert.equal(HASHED_SIZE, "small");
  assert.equal(artworkHashUrl(HASH), "/api/v1/audio/artwork/" + HASH);
  assert.equal(artworkSrc(HASH, SMALL), "/api/v1/audio/artwork/" + HASH, "small: the immutable hash address");
  assert.equal(artworkSrc(HASH, MEDIUM), MEDIUM, "medium keeps the sized resolve address");
  assert.equal(artworkSrc(HASH, MEDIUM.replace("medium", "original")), MEDIUM.replace("medium", "original"));
  assert.equal(artworkSrc(HASH, "/api/v1/audio/artwork?scheme=mpd-path&value=x"), "/api/v1/audio/artwork?scheme=mpd-path&value=x", "no size named: not known to be small");
  assert.equal(artworkSrc(null, SMALL), SMALL, "no hash: the resolve address");
  assert.equal(artworkSrc(HASH, null), null, "the surface paints nothing: nothing");
  assert.ok(!/[?&]/.test(artworkSrc(HASH, SMALL) ?? ""), "a hash address carries no size and no bust");
});

test("a landing re-requests a resolve address and never a hash address", async () => {
  const { withLandingBust, artworkHashUrl } = await helper();
  assert.equal(withLandingBust(SMALL, 0), SMALL, "no landing: unchanged");
  assert.equal(withLandingBust(SMALL, 2), SMALL + "&_t=2", "a landing: a fresh load attempt, no forget");
  assert.equal(withLandingBust(artworkHashUrl(HASH), 3), artworkHashUrl(HASH), "a hash address is immutable");
  assert.equal(withLandingBust(null, 3), null);
});

// ---- the surfaces -------------------------------------------------------------

test("every list surface paints through the one rule", () => {
  for (const rel of ["features/queue/QueueSurface.tsx", "features/queue/ComingNextList.tsx", "features/favourites/FavouritesSurface.tsx", "features/playlist/PlaylistsSurface.tsx"]) {
    const s = code(read(rel));
    assert.ok(!/artworkUrl=\{item\.artworkUrl\}/.test(s), rel + ": not the bare resolve address");
    const uses = (s.match(/artworkUrl=\{artworkSrc\(item\.artworkHash, item\.artworkUrl\)\}/g) ?? []).length;
    assert.ok(uses >= 1, rel + " paints through artworkSrc");
    assert.ok(/import \{ artworkSrc \} from "\.\.\/library\/artwork-src";/.test(read(rel)), rel + " imports the one rule");
  }
  assert.equal((code(read("features/queue/QueueSurface.tsx")).match(/artworkSrc\(item\.artworkHash, item\.artworkUrl\)/g) ?? []).length, 2, "queue list and tile");
  const lib = code(read("features/library/LibrarySurface.tsx"));
  const fileTile = between(lib, "const renderFileTile = (entry: LibraryEntry) => {", "placeholderIcon=");
  assert.ok(/artworkUrl=\{browseArtworkOn \? artworkSrc\(entry\.artworkHash, entry\.artworkUrl\) : null\}/.test(fileTile), "file rows (browse, drill, search) keep the toggle and paint through the rule");
  const facet = code(read("features/library/FacetTile.tsx"));
  assert.ok(/: bustParts\.length === 0\s*\? artworkSrc\(entry\.artworkHash, base\)/.test(facet), "the facet tile paints the hash only while neither refreshed nor landed");
  assert.ok(/if \(nonce > 0\) bustParts\.push\(`refresh=1&_r=m\$\{nonce\}`\);/.test(facet) && /if \(reloadTick > 0\) bustParts\.push\(`_t=\$\{reloadTick\}`\);/.test(facet), "Refresh and the landing bust are unchanged");
  assert.ok(/applyArtworkSize\(entry\.coverUrl, readArtworkSize\(\)\)/.test(facet), "the operator's size still decides the facet address");
});

test("tiles hear landings: one subscription in the shell; a resolve-address tile re-requests, a hash tile does not", () => {
  const app = code(read("app/App.tsx"));
  const lib = code(read("features/library/LibrarySurface.tsx"));
  assert.equal((app.match(/useArtworkResolvedSubscription\(\);/g) ?? []).length, 1, "mounted once in the shell");
  assert.ok(!/useArtworkResolvedSubscription\(\)/.test(lib), "no longer mounted by the Library page alone");
  let mounts = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSafe(dir)) {
      const p = join(dir, name);
      if (name.endsWith(".ts") || name.endsWith(".tsx")) mounts += (code(readFileSync(p, "utf8")).match(/useArtworkResolvedSubscription\(\);/g) ?? []).length;
      else if (!name.includes(".")) walk(p);
    }
  };
  walk(root);
  assert.equal(mounts, 1, "exactly one mount in the whole shell");
  const tile = code(read("components/TrackTile.tsx"));
  assert.ok(/const landing = useArtworkResolvedTick\(artworkUrl\);/.test(tile), "the tile follows its own key");
  assert.ok(/src=\{withLandingBust\(artworkUrl, landing\)\}/.test(tile), "a landing re-requests a resolve address; a hash address stays");
});

test("now_playing art is not touched; no row id; helper ASCII", () => {
  for (const rel of ["features/playback/StageSurface.tsx", "features/pivot/PivotArtReveal.tsx", "features/playback/now-playing-decoders.ts"]) {
    assert.ok(!/artworkHash|artworkSrc|artwork_hash/.test(read(rel)), rel + " untouched");
  }
  if (existsSync(helperPath)) {
    const h = readFileSync(helperPath, "utf8");
    assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(h));
    assert.ok(!/\b[A-Z][0-9]\b/.test(h));
  }
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
