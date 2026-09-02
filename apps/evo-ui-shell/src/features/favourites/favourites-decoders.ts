import {
  decodeClassicalTags,
  type ClassicalTags
} from "../classical/classical-tags.ts";

// Pure decoders for the audio.favourites shelf.
//
// Live wire shape captured on the rig:
//
//   list_favourites -> { v:1, count, items:[FavouriteItem] }
//
//   FavouriteItem = {
//     uri, position,
//     added_at_ms,             // null on legacy / pre-stamp adds
//     source_id,
//     title, artist, album,
//     duration_ms,
//     available                // sticker-reconciler signal
//   }
//
//   is_favourite -> { v:1, uri, is_favourite:bool }
//
// Decoders return null only on shape failure; optional fields
// decode to null and the UI shows a fallback.

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

export interface FavouriteItem {
  uri: string;
  position: number;
  addedAtMs: number | null;
  sourceId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Cover art URL from the wire (artwork_url); null when absent.
   *  The tile falls back to its placeholder - the wire has carried
   *  this all along, the decoder used to drop it. */
  artworkUrl: string | null;
  /** Framework cascade primitive (audio.favourites.v1 +
   *  PLUGIN_CONTRACT.md §15): sticker > source-state > null.
   *  See `QueueItem.available` for the full contract. `null` means
   *  truth unknown - render neutrally, never as UNAVAIL. */
  available: boolean | null;
  /** Section A classical-metadata projection. See `QueueItem.classical`. */
  classical: ClassicalTags | null;
}

export function decodeFavouriteItem(raw: unknown): FavouriteItem | null {
  if (!isObject(raw)) return null;
  const uri = stringOrNull(raw, "uri");
  const position = intOrNull(raw, "position");
  if (uri === null || position === null) return null;
  return {
    uri,
    position,
    addedAtMs: intOrNull(raw, "added_at_ms"),
    sourceId: stringOrNull(raw, "source_id"),
    title: stringOrNull(raw, "title"),
    artist: stringOrNull(raw, "artist"),
    album: stringOrNull(raw, "album"),
    durationMs: intOrNull(raw, "duration_ms"),
    artworkUrl: (() => {
      const v = stringOrNull(raw, "artwork_url");
      return v !== null && v.length > 0 ? v : null;
    })(),
    available:
      typeof raw["available"] === "boolean" ? (raw["available"] as boolean) : null,
    classical: decodeClassicalTags(raw)
  };
}

export interface FavouritesState {
  count: number;
  items: FavouriteItem[];
}

export function decodeFavouritesState(raw: unknown): FavouritesState | null {
  if (!isObject(raw)) return null;
  const itemsRaw = raw["items"];
  const items: FavouriteItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const entry of itemsRaw) {
      const decoded = decodeFavouriteItem(entry);
      if (decoded !== null) items.push(decoded);
    }
  }
  return {
    count: intOrNull(raw, "count") ?? items.length,
    items
  };
}

/** Decode a favourites state from a subject_state_changed
 *  happening for the audio_favourites subject. */
export function decodeFavouritesStateHappening(
  raw: unknown
): FavouritesState | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_favourites") return null;
  return decodeFavouritesState(frame["new_state"]);
}

export interface IsFavouriteResponse {
  uri: string;
  isFavourite: boolean;
}

export function decodeIsFavourite(raw: unknown): IsFavouriteResponse | null {
  if (!isObject(raw)) return null;
  const uri = stringOrNull(raw, "uri");
  if (uri === null) return null;
  return {
    uri,
    isFavourite: boolOr(raw, "is_favourite", false)
  };
}
