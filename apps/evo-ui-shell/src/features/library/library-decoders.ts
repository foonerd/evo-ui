import {
  decodeClassicalTags,
  type ClassicalTags
} from "../classical/classical-tags.ts";
import { t } from "../../runtime/i18n.ts";

// Pure decoders for the audio.library shelf.
//
// Wire shapes captured live on the rig against the deployed binary
// (the four-shelf surface):
//
//   library.list_sources ->
//     { v:1, total, sources:[SourceRecord] }
//
//   library.browse_library ->
//     { v:1, source_id, path, entries:[Entry],
//       source_state, stale }
//
//   library.probe_source ->
//     { v:1, source_id, state, probed_at_ms, probe_duration_ms }
//
//   library.update_source ->
//     { scan_started:bool, job_id?:u64 }
//
//   library.search_library ->
//     { v:1, results:[{...track fields...}], more, query }
//     (results clamp to 1000 server-side per the memo)
//
// SourceRecord:
//   { id, display_name, kind: {kind: SourceKind, ...},
//     mount_path, probe_cadence_ms, scan_policy,
//     state: {kind: SourceState, ...},
//     track_count, track_count_available }
//
// Entry:
//   { kind: "directory"|"file"|"playlist", name, uri }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intField(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function boolField(
  o: Record<string, unknown>,
  k: string,
  fallback: boolean
): boolean {
  const v = o[k];
  return typeof v === "boolean" ? v : fallback;
}

/** Source kind discriminator, mirrors the framework's
 *  SourceKindWire enum. The UI surfaces the kind via a class chip
 *  and decides per-kind add-source dialog shape. Unrecognised
 *  kinds decode as "other" so a future framework variant does not
 *  crash the source row. */
export type SourceKind =
  | "local_internal"
  | "local_usb"
  | "network_nas_smb"
  | "network_nas_nfs"
  | "network_dlna"
  | "cloud_gdrive"
  | "cloud_onedrive"
  | "other";

function decodeSourceKind(raw: unknown): SourceKind {
  if (!isObject(raw)) return "other";
  const kind = raw["kind"];
  switch (kind) {
    case "local_internal":
    case "local_usb":
    case "network_nas_smb":
    case "network_nas_nfs":
    case "network_dlna":
    case "cloud_gdrive":
    case "cloud_onedrive":
      return kind;
    default:
      return "other";
  }
}

/** Source state discriminator. Drives the badge colour + which
 *  affordances enable (Update refuses on offline; Browse serves
 *  stale on offline; Wake is the recovery affordance). */
export type SourceState =
  | "online"
  | "probing"
  | "offline"
  | "degraded"
  | "other";

function decodeSourceState(raw: unknown): SourceState {
  if (!isObject(raw)) return "other";
  const kind = raw["kind"];
  switch (kind) {
    case "online":
    case "probing":
    case "offline":
    case "degraded":
      return kind;
    default:
      return "other";
  }
}

/** Decoded SourceRecord from library.list_sources. */
export interface SourceRecord {
  id: string;
  displayName: string;
  kind: SourceKind;
  mountPath: string;
  probeCadenceMs: number;
  state: SourceState;
  trackCount: number;
  trackCountAvailable: number;
}

export function decodeSourceRecord(raw: unknown): SourceRecord | null {
  if (!isObject(raw)) return null;
  const id = stringField(raw, "id");
  const displayName = stringField(raw, "display_name");
  if (id === null || displayName === null) return null;
  return {
    id,
    displayName,
    kind: decodeSourceKind(raw["kind"]),
    mountPath: stringField(raw, "mount_path") ?? "",
    probeCadenceMs: intField(raw, "probe_cadence_ms") ?? 0,
    state: decodeSourceState(raw["state"]),
    trackCount: intField(raw, "track_count") ?? 0,
    trackCountAvailable: intField(raw, "track_count_available") ?? 0
  };
}

export interface ListSourcesResponse {
  sources: SourceRecord[];
  total: number;
}

export function decodeListSources(raw: unknown): ListSourcesResponse | null {
  if (!isObject(raw)) return null;
  const sourcesRaw = raw["sources"];
  const sources: SourceRecord[] = [];
  if (Array.isArray(sourcesRaw)) {
    for (const entry of sourcesRaw) {
      const decoded = decodeSourceRecord(entry);
      if (decoded !== null) sources.push(decoded);
    }
  }
  return {
    sources,
    total: intField(raw, "total") ?? sources.length
  };
}

/** Decode an audio_library_sources subject_state_changed happening. */
export function decodeListSourcesHappening(
  raw: unknown
): ListSourcesResponse | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_library_sources") return null;
  return decodeListSources(frame["new_state"]);
}

/** Live scan phase per the audio_library_scan_progress contract. */
export type ScanPhase = "scanning" | "complete";

/** One in-flight (or just-terminated) scan for a single source, from
 *  the audio_library_scan_progress subject. `estimatedTotal` is null
 *  when the framework's start-time file walk could not complete inside
 *  its budget (large / permission-degraded trees) - render a count-only
 *  "Indexing N" in that case rather than a bogus "N of null". */
export interface ScanProgressEntry {
  sourceId: string;
  /** "update" (add-only, monotonic) or "rescan" (may dip during
   *  stale-cleanup before settling). */
  kind: string;
  scannedTracks: number;
  estimatedTotal: number | null;
  phase: ScanPhase;
}

/** Decode an audio_library_scan_progress subject_state_changed happening
 *  into the (possibly empty) set of active/terminal scans. Returns:
 *   - the scans array (possibly `[]` for the idle/terminal-cleared state)
 *     when the frame IS a scan-progress subject update, so the caller can
 *     clear stale progress on the empty envelope;
 *   - `null` when the frame is a different subject (caller ignores).
 *  Empty-vs-null is the explicit signal, never a silent fallback. */
export function decodeScanProgressHappening(
  raw: unknown
): ScanProgressEntry[] | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_library_scan_progress") return null;
  const newState = frame["new_state"];
  if (!isObject(newState)) return null;
  const scansRaw = newState["scans"];
  const out: ScanProgressEntry[] = [];
  if (Array.isArray(scansRaw)) {
    for (const entry of scansRaw) {
      if (!isObject(entry)) continue;
      const sourceId = stringField(entry, "source_id");
      const phase = entry["phase"];
      if (sourceId === null) continue;
      if (phase !== "scanning" && phase !== "complete") continue;
      out.push({
        sourceId,
        kind: stringField(entry, "kind") ?? "",
        scannedTracks: intField(entry, "scanned_tracks") ?? 0,
        estimatedTotal: intField(entry, "estimated_total"),
        phase
      });
    }
  }
  return out;
}

/** A single entry in a library.browse_library response. */
export type LibraryEntryKind = "directory" | "file" | "playlist";

export interface LibraryEntry {
  kind: LibraryEntryKind;
  name: string;
  /** The entry's stable identity. Directories carry a source-relative
   *  navigation path (opaque objectId for a network source; folder
   *  path for a local source); the UI drills into a directory by
   *  passing this back as the `path` parameter of a follow-up
   *  `library.browse_library` call.
   *
   *  File entries carry a scheme-tagged track identity that the
   *  operator glass stores and replays verbatim. For network sources
   *  the scheme is source-owned - a DLNA MediaServer entry carries
   *  `dlna:<service_id>/<objectId>` here, not the concrete
   *  `http(s)` stream URL. The stream is a device-side detail: the
   *  favourites store, the playlist store, and `queue.enqueue` all
   *  accept this stable form; the framework resolves it to `http(s)`
   *  at the MPD-add boundary via a peer-shelf call to the owning
   *  source plugin. The UI stores and replays `entry.uri` verbatim
   *  for play, queue, favourite, and playlist actions with zero
   *  identity synthesis. */
  uri: string;
  /** Real track title from the file's tags (file entries only); null
   *  for directories / playlists or when untagged. The wire carries
   *  this alongside `name` (the filename) - a tile should prefer the
   *  title and fall back to the filename. */
  title: string | null;
  /** Track artist from tags (file entries); null otherwise. */
  artist: string | null;
  /** Album from tags (file entries); null otherwise. */
  album: string | null;
  /** Resolver URL for this entry's cover (mpd-album keyed, so all
   *  tracks in one album share it); null when the wire omits it. The
   *  tile lazy-loads it; the browse-artwork flag gates whether the
   *  render uses it. */
  artworkUrl: string | null;
  /** Directory entries carry a `cover_url` (mpd-directory scheme) -
   *  the folder's own art (folder.jpg / cover.jpg / embedded), so a
   *  folder tile shows its cover instead of a generic folder glyph.
   *  null for files / when the folder has no art. */
  coverUrl: string | null;
  /** Section A classical-metadata projection. Only meaningful for
   *  file-kind entries; framework leaves directory + playlist entries
   *  null because those reference containers, not tracks. */
  classical: ClassicalTags | null;
}

function decodeEntryKind(raw: unknown): LibraryEntryKind | null {
  if (raw === "directory" || raw === "file" || raw === "playlist") {
    return raw;
  }
  return null;
}

export function decodeLibraryEntry(raw: unknown): LibraryEntry | null {
  if (!isObject(raw)) return null;
  const kind = decodeEntryKind(raw["kind"]);
  const name = stringField(raw, "name");
  const uri = stringField(raw, "uri");
  if (kind === null || name === null || uri === null) return null;
  return {
    kind,
    name,
    uri,
    title: stringField(raw, "title"),
    artist: stringField(raw, "artist"),
    album: stringField(raw, "album"),
    artworkUrl: stringField(raw, "artwork_url"),
    coverUrl: stringField(raw, "cover_url"),
    classical: decodeClassicalTags(raw)
  };
}

export interface BrowseLibraryResponse {
  sourceId: string;
  path: string;
  entries: LibraryEntry[];
  sourceState: SourceState;
  /** True when the source is offline and the framework served the
   *  last-cached listing. The UI surfaces a stale banner. */
  stale: boolean;
  /** Current page index (0-based). Absent / non-numeric → 0. */
  page: number;
  /** True when more pages remain (DLNA ContentDirectory paging). */
  truncated: boolean;
  /** Next page index when more remain; null when exhausted. */
  nextPage: number | null;
}

export function decodeBrowseLibrary(raw: unknown): BrowseLibraryResponse | null {
  if (!isObject(raw)) return null;
  const sourceId = stringField(raw, "source_id");
  if (sourceId === null) return null;
  const entriesRaw = raw["entries"];
  const entries: LibraryEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const entry of entriesRaw) {
      const decoded = decodeLibraryEntry(entry);
      if (decoded !== null) entries.push(decoded);
    }
  }
  const nextRaw = raw["next_page"];
  return {
    sourceId,
    path: stringField(raw, "path") ?? "",
    entries,
    sourceState: decodeSourceState(raw["source_state"]),
    stale: boolField(raw, "stale", false),
    page: typeof raw["page"] === "number" ? raw["page"] : 0,
    truncated: boolField(raw, "truncated", false),
    nextPage: typeof nextRaw === "number" ? nextRaw : null
  };
}

/** The tag dimensions the framework can enumerate via the
 *  library.browse_by_<facet> verbs (playback.mpd). Each verb returns a
 *  flat, paginated list of the distinct values for that tag. */
export type FacetKind = "artist" | "album" | "genre" | "year";

/** One entry in a library.browse_by_<facet> enumeration. `value` is the
 *  facet value (artist / album / genre / year string). Album AND artist
 *  entries carry a `cover_url` the tile renders as a plain <img> (album
 *  art via scheme=mpd-album; the artist portrait via scheme=artist-name,
 *  which the framework byte-caches locally). Album entries also carry
 *  artist + trackCount. Genre / year entries are value-only. */
export interface FacetEntry {
  value: string;
  artist: string | null;
  coverUrl: string | null;
  trackCount: number | null;
}

/** Decoded library.browse_by_<facet> response. Wire shape:
 *  { entries:[...], facet, page, page_size, total, next_page,
 *  truncated, v }. Entry shape varies by facet (see FacetEntry). */
export interface FacetBrowseResponse {
  facet: string;
  entries: FacetEntry[];
  page: number;
  total: number;
  nextPage: number | null;
  truncated: boolean;
}

export function decodeFacetBrowse(
  raw: unknown,
  facet: FacetKind
): FacetBrowseResponse | null {
  if (!isObject(raw)) return null;
  const entriesRaw = raw["entries"];
  const entries: FacetEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const entry of entriesRaw) {
      if (!isObject(entry)) continue;
      const v = entry[facet];
      if (typeof v !== "string" || v.length === 0) continue;
      entries.push({
        value: v,
        artist: stringField(entry, "artist"),
        coverUrl: stringField(entry, "cover_url"),
        trackCount: intField(entry, "track_count")
      });
    }
  }
  const nextRaw = raw["next_page"];
  return {
    facet: stringField(raw, "facet") ?? facet,
    entries,
    page: intField(raw, "page") ?? 0,
    total: intField(raw, "total") ?? entries.length,
    nextPage:
      typeof nextRaw === "number" && Number.isFinite(nextRaw)
        ? Math.round(nextRaw)
        : null,
    truncated: boolField(raw, "truncated", false)
  };
}

/** Decode the tracks returned by a browse_by_<facet> drill (select
 *  present). Wire shape is { entries:[{...track fields}], ... } - the
 *  same file-entry shape browse_library emits - so each entry decodes
 *  via decodeLibraryEntry. (BRW-1: exact tag-scoped drill, replacing
 *  the earlier free-text search bridge.) */
export function decodeDrillTracks(raw: unknown): LibraryEntry[] {
  if (!isObject(raw)) return [];
  const entriesRaw = raw["entries"];
  const out: LibraryEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const item of entriesRaw) {
      const decoded = decodeLibraryEntry(item);
      if (decoded !== null) out.push(decoded);
    }
  }
  return out;
}

/** Decode a library.search_library response into track-shaped
 *  LibraryEntry rows. Wire shape { results:[{...track fields}], ... };
 *  each result carries the same file fields decodeLibraryEntry
 *  understands. Retained for the free-text search verb. */
export function decodeSearchResults(raw: unknown): LibraryEntry[] {
  if (!isObject(raw)) return [];
  const resultsRaw = raw["results"];
  const out: LibraryEntry[] = [];
  if (Array.isArray(resultsRaw)) {
    for (const item of resultsRaw) {
      const decoded = decodeLibraryEntry(item);
      if (decoded !== null) out.push(decoded);
    }
  }
  return out;
}

export interface ProbeSourceResponse {
  sourceId: string;
  state: SourceState;
  probedAtMs: number;
  probeDurationMs: number;
}

export function decodeProbeSource(raw: unknown): ProbeSourceResponse | null {
  if (!isObject(raw)) return null;
  const sourceId = stringField(raw, "source_id");
  if (sourceId === null) return null;
  return {
    sourceId,
    state: decodeSourceState(raw["state"]),
    probedAtMs: intField(raw, "probed_at_ms") ?? 0,
    probeDurationMs: intField(raw, "probe_duration_ms") ?? 0
  };
}

export interface UpdateSourceResponse {
  scanStarted: boolean;
  jobId: number | null;
}

export function decodeUpdateSource(raw: unknown): UpdateSourceResponse | null {
  if (!isObject(raw)) return null;
  return {
    scanStarted: boolField(raw, "scan_started", false),
    jobId: intField(raw, "job_id")
  };
}

/** Format a SourceKind as a human-readable label for badges /
 *  class-chip text. */
export function formatSourceKind(k: SourceKind): string {
  switch (k) {
    case "local_internal":
      return t("library.kind.local");
    case "local_usb":
      return "USB";
    case "network_nas_smb":
      return "SMB";
    case "network_nas_nfs":
      return "NFS";
    case "network_dlna":
      return "Media server";
    case "cloud_gdrive":
      return "Google Drive";
    case "cloud_onedrive":
      return "OneDrive";
    default:
      return t("library.kind.generic");
  }
}

/** True when the framework refuses Remove for this source -
 *  matches the memo's "local-internal is the non-removable floor
 *  source" invariant. */
export function isRemovable(k: SourceKind): boolean {
  return k !== "local_internal";
}

/** Format a SourceState as a human-readable label for the badge.
 *  The class name is derived independently in the CSS for state-
 *  specific colours. */
export function formatSourceState(s: SourceState): string {
  switch (s) {
    case "online":
      return t("library.state.online");
    case "probing":
      return t("library.state.probing");
    case "offline":
      return t("library.state.offline");
    case "degraded":
      return t("library.state.degraded");
    default:
      return t("library.state.unknown");
  }
}
