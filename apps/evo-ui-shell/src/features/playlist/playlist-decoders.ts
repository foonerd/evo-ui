import {
  decodeClassicalTags,
  type ClassicalTags
} from "../classical/classical-tags.ts";

// Pure decoders for the audio.playlist shelf.
//
// Live wire on the rig (post-shelf-surface):
//
//   list_playlists -> { v:1, playlists:[PlaylistIndexEntry] }
//   PlaylistIndexEntry = { name, item_count, modified_at_ms }
//
//   get_playlist -> { v:1, name, item_count, items:[PlaylistItem] }
//   PlaylistItem - same enrichment shape as audio_queue / favourites
//     items: { uri, position, title, artist, album,
//              duration_ms, artwork_url, source_id, available }
//
// Important: `__favourites__` IS returned by list_playlists on the
// wire today (despite the memo's "excludes" claim) - the UI filters
// it out client-side. This decoder leaves the list untouched; the
// filter happens at the surface so unit tests against the decoder
// see the raw wire.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOrNull(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function boolOr(
  o: Record<string, unknown>,
  k: string,
  fallback: boolean
): boolean {
  const v = o[k];
  return typeof v === "boolean" ? v : fallback;
}

/** The reserved playlist name the favourites surface uses
 *  internally. Filtered out of the playlist index because
 *  CRUD on it would violate the framework's "delete /
 *  rename refuse __favourites__" invariant. */
export const RESERVED_FAVOURITES_PLAYLIST = "__favourites__";

export interface PlaylistIndexEntry {
  name: string;
  /** Framework contract (audio.playlist.v1 + PLUGIN_CONTRACT.md §15):
   *  `null` means MPD truth has not yet been determined for this
   *  playlist (rehydration in flight, idle event pending); the literal
   *  `0` means MPD reports zero items. The two are NOT interchangeable
   *  and rendering `null` as "0 tracks" is explicitly forbidden by the
   *  catalogue acceptance row. */
  itemCount: number | null;
  modifiedAtMs: number | null;
}

export function decodePlaylistIndexEntry(
  raw: unknown
): PlaylistIndexEntry | null {
  if (!isObject(raw)) return null;
  const name = stringOrNull(raw, "name");
  if (name === null) return null;
  return {
    name,
    itemCount: intOrNull(raw, "item_count"),
    modifiedAtMs: intOrNull(raw, "modified_at_ms")
  };
}

export interface PlaylistIndex {
  playlists: PlaylistIndexEntry[];
}

export function decodePlaylistIndex(raw: unknown): PlaylistIndex | null {
  if (!isObject(raw)) return null;
  const playlistsRaw = raw["playlists"];
  const playlists: PlaylistIndexEntry[] = [];
  if (Array.isArray(playlistsRaw)) {
    for (const entry of playlistsRaw) {
      const decoded = decodePlaylistIndexEntry(entry);
      if (decoded !== null) playlists.push(decoded);
    }
  }
  return { playlists };
}

/** Decode a subject_state_changed happening for the
 *  audio_playlist_index subject. */
export function decodePlaylistIndexHappening(
  raw: unknown
): PlaylistIndex | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_playlist_index") return null;
  return decodePlaylistIndex(frame["new_state"]);
}

/** Filter the favourites pseudo-playlist out of the index. The UI
 *  surfaces favourites via the dedicated FavouritesSurface, so the
 *  playlist index should only show user-managed playlists. */
export function filterFavouritesOut(index: PlaylistIndex): PlaylistIndex {
  return {
    playlists: index.playlists.filter(
      (p) => p.name !== RESERVED_FAVOURITES_PLAYLIST
    )
  };
}

export interface PlaylistItem {
  uri: string;
  position: number;
  sourceId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Resolved artwork URL from the wire's `artwork_url` field.
   *  Tolerant: missing / non-string / empty string all decode to
   *  null. See `QueueItem.artworkUrl`. */
  artworkUrl: string | null;
  /** Framework cascade primitive (audio.playlist.v1 +
   *  PLUGIN_CONTRACT.md §15): sticker > source-state > null.
   *  See `QueueItem.available` for the full contract. `null` means
   *  truth unknown - render neutrally, never as UNAVAIL. */
  available: boolean | null;
  /** Section A classical-metadata projection. See `QueueItem.classical`. */
  classical: ClassicalTags | null;
}

export function decodePlaylistItem(raw: unknown): PlaylistItem | null {
  if (!isObject(raw)) return null;
  const uri = stringOrNull(raw, "uri");
  const position = intOrNull(raw, "position");
  if (uri === null || position === null) return null;
  return {
    uri,
    position,
    sourceId: stringOrNull(raw, "source_id"),
    title: stringOrNull(raw, "title"),
    artist: stringOrNull(raw, "artist"),
    album: stringOrNull(raw, "album"),
    durationMs: intOrNull(raw, "duration_ms"),
    artworkUrl: stringOrNull(raw, "artwork_url"),
    available:
      typeof raw["available"] === "boolean" ? (raw["available"] as boolean) : null,
    classical: decodeClassicalTags(raw)
  };
}

export interface PlaylistContents {
  name: string;
  itemCount: number;
  items: PlaylistItem[];
}

export function decodePlaylistContents(
  raw: unknown
): PlaylistContents | null {
  if (!isObject(raw)) return null;
  const name = stringOrNull(raw, "name");
  if (name === null) return null;
  const itemsRaw = raw["items"];
  const items: PlaylistItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const entry of itemsRaw) {
      const decoded = decodePlaylistItem(entry);
      if (decoded !== null) items.push(decoded);
    }
  }
  return {
    name,
    itemCount: intOrNull(raw, "item_count") ?? items.length,
    items
  };
}

/** Format a modified_at_ms millis timestamp as a relative string
 *  for the index ("today", "2 days ago", "5 weeks ago"). Returns
 *  "-" for null. */
export function formatRelativeMs(
  ms: number | null,
  now: number = Date.now()
): string {
  if (ms === null) return "-";
  const delta = Math.max(0, now - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}
