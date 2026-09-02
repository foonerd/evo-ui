import {
  decodeClassicalTags,
  type ClassicalTags
} from "../classical/classical-tags.ts";

// Pure decoders for the evo.audio.playback now_playing subject.
//
// The playback warden publishes a now_playing subject (scheme
// "evo.audio.playback", value "now_playing", subject_type
// "audio_playback_now_playing"). Its state payload v1 -
//   { v, transport_state, track, elapsed_ms, duration_ms, volume,
//     muted, repeat, shuffle, single, consume }
// - arrives inline on the framework's subject_state_changed
// happening in the happening's new_state field, on first render
// and on every change.
//
// transport_state is one of "playing" / "paused" / "stopped".
// track is null when stopped, otherwise an object with optional
// title / artist / album (each string-or-null) plus a mandatory
// mpd_path. elapsed_ms and duration_ms are number-or-null.
//
// Kept pure and Preact-free so the contract tests exercise these
// against synthesised wire frames - mirrors stream-format-decoders.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Optional string field - returns null for absent / null / empty
 *  / non-string values. Used for the Option<String> track fields. */
function optionalString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Required non-empty string field, or null when absent / unusable. */
function requiredString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Optional integer milliseconds field - returns null for absent /
 *  null / non-finite values. */
function optionalIntMs(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Boolean field with a default - the wire always sends these, but
 *  decode defensively so a missing flag is a known false rather
 *  than an undefined. */
function boolField(o: Record<string, unknown>, k: string): boolean {
  return o[k] === true;
}

/** Transport state of the playback warden. */
export type TransportState = "playing" | "paused" | "stopped";

function decodeTransportState(raw: unknown): TransportState | null {
  if (raw === "playing" || raw === "paused" || raw === "stopped") {
    return raw;
  }
  return null;
}

/** The track currently loaded in the playback warden. Present
 *  whenever transport_state is "playing" or "paused"; null when
 *  "stopped". title / artist / album are each null when the file
 *  carried no such tag. mpdPath is the warden's stable handle. */
export interface NowPlayingTrack {
  title: string | null;
  artist: string | null;
  album: string | null;
  mpdPath: string;
  /** Resolved artwork URL for this track, from the now_playing wire
   *  field `artwork_url` (the playback warden emits it via
   *  artwork_target_url). null when the wire omits it. The UI uses it
   *  directly as an <img> source and falls back to a placeholder when
   *  it is null or fails to load. */
  artworkUrl: string | null;
  /** Section A classical-metadata projection. See QueueItem.classical
   *  in audio-queue-decoders.ts for the full contract. `null` when
   *  the now-playing track has no classical tags. */
  classical: ClassicalTags | null;
}

/** Decoded now_playing subject state. Mirrors the v1 payload with
 *  the wire's snake_case fields renamed to the UI's camelCase. */
export interface NowPlaying {
  transportState: TransportState;
  /** Loaded track, or null when transport_state is "stopped". */
  track: NowPlayingTrack | null;
  /** Elapsed playback position in milliseconds, or null when not
   *  knowable (nothing loaded, or the warden has not reported it). */
  elapsedMs: number | null;
  /** Track duration in milliseconds, or null when not knowable. */
  durationMs: number | null;
  /** Output volume, 0-100. */
  volume: number;
  muted: boolean;
  repeat: boolean;
  shuffle: boolean;
  single: boolean;
  consume: boolean;
}

/** Decode one now_playing track value. Returns null when the value
 *  is not a usable track object - the caller treats a null track as
 *  "nothing loaded". A track object missing mpd_path is rejected:
 *  mpd_path is the warden's mandatory stable handle. */
export function decodeNowPlayingTrack(raw: unknown): NowPlayingTrack | null {
  if (!isObject(raw)) return null;
  const mpdPath = requiredString(raw, "mpd_path");
  if (mpdPath === null) return null;
  return {
    title: optionalString(raw, "title"),
    artist: optionalString(raw, "artist"),
    album: optionalString(raw, "album"),
    mpdPath,
    artworkUrl: optionalString(raw, "artwork_url"),
    classical: decodeClassicalTags(raw)
  };
}

/** Decode a now_playing subject-state payload into a NowPlaying,
 *  or null when the payload is not an object or carries no
 *  recognised transport_state. The track is decoded leniently - a
 *  null / absent / unreadable track field decodes to a null track
 *  (the normal shape while stopped). */
export function decodeNowPlaying(raw: unknown): NowPlaying | null {
  if (!isObject(raw)) return null;
  const transportState = decodeTransportState(raw["transport_state"]);
  if (transportState === null) return null;
  const volumeRaw = raw["volume"];
  const volume =
    typeof volumeRaw === "number" && Number.isFinite(volumeRaw)
      ? Math.min(100, Math.max(0, Math.round(volumeRaw)))
      : 0;
  return {
    transportState,
    track: decodeNowPlayingTrack(raw["track"]),
    elapsedMs: optionalIntMs(raw, "elapsed_ms"),
    durationMs: optionalIntMs(raw, "duration_ms"),
    volume,
    muted: boolField(raw, "muted"),
    repeat: boolField(raw, "repeat"),
    shuffle: boolField(raw, "shuffle"),
    single: boolField(raw, "single"),
    consume: boolField(raw, "consume")
  };
}

/** Decode a now_playing reading from a happening frame. Returns
 *  null when the frame is not a subject_state_changed happening for
 *  the audio_playback_now_playing subject. Unwraps a leading
 *  { happening: ... } envelope - mirrors decodeStreamFormatHappening. */
export function decodeNowPlayingHappening(raw: unknown): NowPlaying | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_playback_now_playing") return null;
  return decodeNowPlaying(frame["new_state"]);
}

/** A captured (elapsedMs, wall-clock) pair the UI anchors live
 *  progress interpolation against. The warden publishes now_playing
 *  only on transitions - play / pause / stop / track change / seek -
 *  never on the playhead simply advancing. Between those sparse
 *  updates the UI advances the displayed position itself, from this
 *  anchor, so the progress bar moves in real time. */
export interface ElapsedAnchor {
  /** Elapsed position the warden last reported, in milliseconds. */
  elapsedMs: number;
  /** Wall-clock time that report was observed (Date.now()). */
  atMs: number;
}

/** Interpolate the displayed elapsed position from an anchor.
 *
 *  While `isPlaying`, the position advances by the wall-clock time
 *  elapsed since the anchor was captured; otherwise it holds at the
 *  anchored value. The result is floored at 0 and, when `durationMs`
 *  is a positive number, capped at `durationMs` so the progress bar
 *  never overruns the track. A backwards clock (`nowMs` before the
 *  anchor) cannot push the position below the anchored value. */
export function interpolateElapsedMs(
  anchor: ElapsedAnchor,
  nowMs: number,
  isPlaying: boolean,
  durationMs: number | null
): number {
  const advanced = isPlaying
    ? anchor.elapsedMs + Math.max(0, nowMs - anchor.atMs)
    : anchor.elapsedMs;
  const floored = Math.max(0, advanced);
  if (durationMs !== null && durationMs > 0) {
    return Math.min(floored, durationMs);
  }
  return floored;
}
