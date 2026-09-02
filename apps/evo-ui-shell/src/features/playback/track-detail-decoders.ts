// Pure decoders for the composite /api/v1/audio/track_detail endpoint.
//
// Wire shape captured live from the device (2026-07-23, keyless cascade):
//   { v, status, target,
//     sources: {
//       artist_bio / album_notes: {
//         status, provider_id, privacy_class,
//         attribution: { source_name, source_url, license },
//         enhancement: { provider, requires_key, reason },
//         payload: { language, source_url, summary, title } },
//       lyrics:         { status, provider_id, payload: { plain_lyrics,
//                         synced_lyrics, is_synced, source_url } },
//       artwork:        { status, payload: { content_hash, size, url } },
//       metadata_local: { status, payload: {...tags...} },
//       reconciliation: { status,
//         payload: { canonical: { recording_type, first_release_year,
//                                 release_mbid, artist_mbid, track_count },
//                    confidence_percent } } } }
//
// Every enrichment source is anonymous-first and degrades honestly:
// `ok` carries the payload + attribution the UI MUST render; a keyed
// provider that could enrich further surfaces as an `enhancement` hint.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function intOrNull(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function stringOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** MusicBrainz recording type, mapped to a closed set. */
export type RecordingType =
  | "Studio"
  | "Live"
  | "Compilation"
  | "Soundtrack"
  | "Other";

function decodeRecordingType(v: unknown): RecordingType | null {
  if (typeof v !== "string" || v.length === 0) return null;
  switch (v) {
    case "Studio":
    case "Live":
    case "Compilation":
    case "Soundtrack":
      return v;
    default:
      return "Other";
  }
}

export interface TrackReconciliation {
  recordingType: RecordingType | null;
  firstReleaseYear: number | null;
  confidencePercent: number | null;
}

/** Per-source status token, closed set. */
export type SourceStatus =
  | "ok"
  | "not_found"
  | "not_configured"
  | "bad_request"
  | "error"
  | "absent";

function decodeSourceStatus(raw: unknown): SourceStatus {
  if (typeof raw !== "string") return "absent";
  switch (raw) {
    case "ok":
    case "not_found":
    case "not_configured":
    case "bad_request":
    case "error":
      return raw;
    default:
      return "absent";
  }
}

/** Whether the winning provider needed an account credential. */
export type PrivacyClass = "anonymous" | "identity_bearing";

function decodePrivacyClass(raw: unknown): PrivacyClass | null {
  return raw === "anonymous" || raw === "identity_bearing" ? raw : null;
}

/** Attribution the UI MUST render beside any surfaced payload. */
export interface SourceAttribution {
  sourceName: string;
  sourceUrl: string | null;
  license: string;
}

function decodeAttribution(raw: unknown): SourceAttribution | null {
  if (!isObject(raw)) return null;
  const sourceName = stringOrNull(raw, "source_name");
  const license = stringOrNull(raw, "license");
  if (sourceName === null || license === null) return null;
  return {
    sourceName,
    sourceUrl: stringOrNull(raw, "source_url"),
    license
  };
}

/** Hint pointing at a provider the operator could enable to enrich
 *  the answer further. The UI renders it as an "add a key" affordance,
 *  never a coercion. */
export interface EnhancementHint {
  provider: string;
  requiresKey: boolean;
  reason: string | null;
}

function decodeEnhancement(raw: unknown): EnhancementHint | null {
  if (!isObject(raw)) return null;
  const provider = stringOrNull(raw, "provider");
  if (provider === null) return null;
  return {
    provider,
    requiresKey: raw["requires_key"] === true,
    reason: stringOrNull(raw, "reason")
  };
}

/** One provider's contribution to a section's `sources[]` envelope. */
export interface EnrichmentSourceEntry {
  providerId: string | null;
  privacyClass: PrivacyClass | null;
  attribution: SourceAttribution | null;
  text: string | null;
  sourceUrl: string | null;
}

/** A decoded enrichment source (artist bio, album notes). Carries the
 *  best available answer plus its provenance, so a section renders the
 *  text + attribution and, when present, offers the enhancement. */
export interface EnrichmentSource {
  status: SourceStatus;
  providerId: string | null;
  privacyClass: PrivacyClass | null;
  attribution: SourceAttribution | null;
  enhancement: EnhancementHint | null;
  /** The text body (summary or content), null when absent. */
  text: string | null;
  /** Canonical link back to the source page - from attribution first,
   *  then the payload. */
  sourceUrl: string | null;
  /** Every provider that returned content for this section, each with
   *  its own attribution. Mirrors the top-level fields at [0] when
   *  present; empty when single-source or absent. */
  sources: EnrichmentSourceEntry[];
}

const ABSENT_SOURCE: EnrichmentSource = {
  status: "absent",
  providerId: null,
  privacyClass: null,
  attribution: null,
  enhancement: null,
  text: null,
  sourceUrl: null,
  sources: []
};

/** Strip provider markup from enrichment prose so it renders as clean
 *  plain text on an appliance. Removes whole anchor tags including their
 *  inner text - a Last.fm "Read more on Last.fm" link has no target on a
 *  kiosk and the source link already lives in the attribution line -
 *  plus any other HTML tags and common entities, and tidies the
 *  punctuation a stripped trailing link leaves behind. Truncated
 *  provider snippets stay truncated: completeness is a source choice,
 *  handled by preferring a full-text provider, not by the renderer. */
function cleanProse(s: string | null): string | null {
  if (s === null) return null;
  const out = s
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return out.length > 0 ? out : null;
}

function decodeEnrichmentEntry(raw: unknown): EnrichmentSourceEntry | null {
  if (!isObject(raw)) return null;
  const attribution = decodeAttribution(raw["attribution"]);
  const payload = isObject(raw["payload"]) ? raw["payload"] : null;
  const text =
    payload !== null
      ? cleanProse(stringOrNull(payload, "summary") ?? stringOrNull(payload, "content"))
      : null;
  const providerId = stringOrNull(raw, "provider_id");
  if (providerId === null && attribution === null && text === null) return null;
  return {
    providerId,
    privacyClass: decodePrivacyClass(raw["privacy_class"]),
    attribution,
    text,
    sourceUrl:
      attribution?.sourceUrl ??
      (payload !== null ? stringOrNull(payload, "source_url") : null)
  };
}

function decodeEnrichmentSource(raw: unknown): EnrichmentSource {
  if (!isObject(raw)) return ABSENT_SOURCE;
  const attribution = decodeAttribution(raw["attribution"]);
  const payload = isObject(raw["payload"]) ? raw["payload"] : null;
  const text =
    payload !== null
      ? cleanProse(stringOrNull(payload, "summary") ?? stringOrNull(payload, "content"))
      : null;
  const sourceUrl =
    attribution?.sourceUrl ??
    (payload !== null ? stringOrNull(payload, "source_url") : null);
  const sources: EnrichmentSourceEntry[] = [];
  const rawSources = raw["sources"];
  if (Array.isArray(rawSources)) {
    for (const e of rawSources) {
      const entry = decodeEnrichmentEntry(e);
      if (entry !== null) sources.push(entry);
    }
  }
  return {
    status: decodeSourceStatus(raw["status"]),
    providerId: stringOrNull(raw, "provider_id"),
    privacyClass: decodePrivacyClass(raw["privacy_class"]),
    attribution,
    enhancement: decodeEnhancement(raw["enhancement"]),
    text,
    sourceUrl,
    sources
  };
}

/** Decoded lyrics source (LRCLIB via the cascade). */
export interface LyricsSource {
  status: SourceStatus;
  providerId: string | null;
  plain: string | null;
  synced: string | null;
  isSynced: boolean;
  sourceUrl: string | null;
}

function decodeLyrics(raw: unknown): LyricsSource {
  if (!isObject(raw)) {
    return {
      status: "absent",
      providerId: null,
      plain: null,
      synced: null,
      isSynced: false,
      sourceUrl: null
    };
  }
  const payload = isObject(raw["payload"]) ? raw["payload"] : null;
  return {
    status: decodeSourceStatus(raw["status"]),
    providerId: stringOrNull(raw, "provider_id"),
    plain: payload !== null ? stringOrNull(payload, "plain_lyrics") : null,
    synced: payload !== null ? stringOrNull(payload, "synced_lyrics") : null,
    isSynced: payload !== null && payload["is_synced"] === true,
    sourceUrl: payload !== null ? stringOrNull(payload, "source_url") : null
  };
}

export interface TrackDetail {
  reconciliation: TrackReconciliation | null;
  artistBio: EnrichmentSource;
  albumNotes: EnrichmentSource;
  lyrics: LyricsSource;
  artwork: SourceStatus;
}

function decodeReconciliation(raw: unknown): TrackReconciliation | null {
  if (!isObject(raw)) return null;
  if (raw["status"] !== "ok") return null;
  const payload = raw["payload"];
  if (!isObject(payload)) return null;
  const canonical = isObject(payload["canonical"]) ? payload["canonical"] : null;
  const recordingType =
    canonical !== null ? decodeRecordingType(canonical["recording_type"]) : null;
  const firstReleaseYear =
    canonical !== null ? intOrNull(canonical, "first_release_year") : null;
  const confidencePercent = intOrNull(payload, "confidence_percent");
  if (
    recordingType === null &&
    firstReleaseYear === null &&
    confidencePercent === null
  ) {
    return null;
  }
  return { recordingType, firstReleaseYear, confidencePercent };
}

/** Decode a track_detail response. Returns null only on a shape
 *  failure (not an object / no `sources`). */
export function decodeTrackDetail(raw: unknown): TrackDetail | null {
  if (!isObject(raw)) return null;
  const sources = raw["sources"];
  if (!isObject(sources)) return null;
  return {
    reconciliation: decodeReconciliation(sources["reconciliation"]),
    artistBio: decodeEnrichmentSource(sources["artist_bio"]),
    albumNotes: decodeEnrichmentSource(sources["album_notes"]),
    lyrics: decodeLyrics(sources["lyrics"]),
    artwork: decodeSourceStatus(
      isObject(sources["artwork"]) ? sources["artwork"]["status"] : undefined
    )
  };
}
