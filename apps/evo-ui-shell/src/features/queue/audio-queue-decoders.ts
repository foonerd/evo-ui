import {
  decodeClassicalTags,
  type ClassicalTags
} from "../classical/classical-tags.ts";

// Pure decoders for the audio.queue subject + verb response shapes.
//
// The playback.mpd plugin publishes audio_queue (scheme
// "evo.audio.queue", value "queue") with state envelope shape per
// queue.rs:217-279 of the plugin source:
//
//   { v: 1,
//     items: [QueueItem],
//     length: u32,           // total count even if items[] truncated
//     current_position: u32 | null,
//     truncated?: bool }     // present + true when items[] is capped
//
// Each item:
//
//   { id:          u32,      // MPD songid - use for mutation
//     position:    u32,      // index in the queue
//     uri:         string,
//     source_id:   string | null,
//     title:       string | null,
//     artist:      string | null,
//     album:       string | null,
//     duration_ms: u64 | null,
//     artwork_url: string | null,
//     available:   bool }    // sticker reconciler's evo:available flag
//
// Decoders return null only on shape failure - missing / wrong-type
// id, position, uri, available. Optional fields (title/artist/album/
// duration_ms/source_id) decode to null and the UI shows a fallback.

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

function intRequired(
  o: Record<string, unknown>,
  k: string
): number | null {
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

/** One queue item per build_envelope's rendered shape. */
export interface QueueItem {
  /** MPD songid - stable across reorders, use for mutation. */
  id: number;
  /** Index in the queue. */
  position: number;
  /** File path or stream URL. */
  uri: string;
  /** Library source id this URI resolves under, or null when the
   *  URI is a stream / out-of-library path. */
  sourceId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  /** Resolved artwork URL from the wire's `artwork_url` field.
   *  Tolerant: missing / non-string / empty string all decode to
   *  null and the UI shows the neutral placeholder square. */
  artworkUrl: string | null;
  /** Framework cascade primitive (audio.queue.v1 +
   *  PLUGIN_CONTRACT.md §15): sticker > source-state > null.
   *
   *  - `true` means KNOWN reachable (sticker=1 OR source Online /
   *    Degraded).
   *  - `false` means KNOWN unreachable (sticker=0 OR source Offline
   *    / Retired). UI surfaces the UNAVAIL chip and dims the row;
   *    skip-traversal advances past it.
   *  - `null` means truth has not yet been determined (source still
   *    Probing AND no sticker; or no registered source). UI MUST
   *    render neutrally - no UNAVAIL chip, no dimming, no
   *    skip-traversal. Forbidden to collapse to `false` per the
   *    catalogue acceptance row
   *    `queue-item-available-cascade-emits-null-on-unknown`. */
  available: boolean | null;
  /** Section A classical-metadata projection. `null` when the row
   *  has no classical tags (the non-classical case - the framework
   *  still emits the 13 fields but they are all null). When present,
   *  carries the 13 fields verbatim from the wire. See
   *  `features/classical/classical-tags.ts`. */
  classical: ClassicalTags | null;
}

/** Decoded audio_queue subject state envelope. */
export interface QueueState {
  /** Index in items[] (0-based) of the currently-playing item, or
   *  null when nothing is playing. */
  currentPosition: number | null;
  /** Total length of the queue. May exceed items.length when the
   *  envelope was truncated. */
  length: number;
  /** Truncation flag - the UI surfaces a footer note when true. */
  truncated: boolean;
  items: QueueItem[];
}

/** Decode a single item from the wire shape. Returns null when a
 *  required field is missing or malformed. */
export function decodeQueueItem(raw: unknown): QueueItem | null {
  if (!isObject(raw)) return null;
  const id = intRequired(raw, "id");
  const position = intRequired(raw, "position");
  const uri = stringOrNull(raw, "uri");
  if (id === null || position === null || uri === null) return null;
  return {
    id,
    position,
    uri,
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

/** Decode the audio_queue state envelope. Items that fail per-item
 *  decode are dropped silently so a partially-malformed envelope
 *  still renders the parts that are honest, rather than failing
 *  the whole queue view. The length / current_position are still
 *  surfaced verbatim from the envelope so the UI shows the wire's
 *  notion of "how many" even if it cannot render all rows. */
export function decodeQueueState(raw: unknown): QueueState | null {
  if (!isObject(raw)) return null;
  const itemsRaw = raw["items"];
  const items: QueueItem[] = [];
  if (Array.isArray(itemsRaw)) {
    for (const entry of itemsRaw) {
      const item = decodeQueueItem(entry);
      if (item !== null) items.push(item);
    }
  }
  const length =
    intOrNull(raw, "length") ?? items.length;
  const currentPosition = intOrNull(raw, "current_position");
  const truncated = boolOr(raw, "truncated", false);
  return {
    currentPosition,
    length,
    truncated,
    items
  };
}

/** Decode a queue state from a happening frame. Returns null when
 *  the frame is not a subject_state_changed for the audio_queue
 *  subject. Unwraps a leading { happening: ... } envelope. */
export function decodeQueueStateHappening(raw: unknown): QueueState | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_queue") return null;
  return decodeQueueState(frame["new_state"]);
}

/** Decoded skip-to-next-available outcome - the discriminator the
 *  verb returns so the UI can surface what actually happened. */
export type SkipOutcome =
  | { kind: "playing"; songid?: number; position?: number }
  | { kind: "paused"; songid?: number; position?: number }
  | { kind: "stopped"; reason?: string };

/** Decode the queue.skip_to_next_available response. */
export function decodeSkipOutcome(raw: unknown): SkipOutcome | null {
  if (!isObject(raw)) return null;
  const outcome = raw["outcome"];
  if (!isObject(outcome)) return null;
  const kind = outcome["kind"];
  if (kind === "playing" || kind === "paused") {
    return {
      kind: kind as "playing" | "paused",
      songid: intOrNull(outcome, "songid") ?? undefined,
      position: intOrNull(outcome, "position") ?? undefined
    };
  }
  if (kind === "stopped") {
    return {
      kind: "stopped",
      reason: stringOrNull(outcome, "reason") ?? undefined
    };
  }
  return null;
}

/** Format a duration_ms field as "m:ss" or "h:mm:ss". Returns "-"
 *  when null so the UI's duration column never shows raw nulls. */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "-";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Derive a per-item codec label from the item's URI extension
 *  (display-only - the authoritative source-codec for the currently-
 *  playing item comes from stream_format, not this). Returns the
 *  upper-case codec token or null if the URI carries no recognised
 *  extension (HTTP stream, no extension, etc.). */
export function codecFromUri(uri: string): string | null {
  const lastDot = uri.lastIndexOf(".");
  const lastSlash = uri.lastIndexOf("/");
  if (lastDot <= lastSlash || lastDot === -1) return null;
  const ext = uri.slice(lastDot + 1).toLowerCase();
  const known: Record<string, string> = {
    flac: "FLAC",
    wav: "WAV",
    aiff: "AIFF",
    aif: "AIFF",
    ape: "APE",
    alac: "ALAC",
    m4a: "M4A",
    wavpack: "WAVPACK",
    wv: "WAVPACK",
    tta: "TTA",
    shn: "SHORTEN",
    dsf: "DSF",
    dff: "DFF",
    mp3: "MP3",
    aac: "AAC",
    ogg: "OGG",
    oga: "OGG",
    opus: "OPUS",
    wma: "WMA",
    mpc: "MUSEPACK",
    mod: "MOD",
    spx: "SPEEX"
  };
  return known[ext] ?? ext.toUpperCase();
}
