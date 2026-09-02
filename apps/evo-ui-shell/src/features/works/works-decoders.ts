// Pure decoders for the Works shelf (Section B + C closure - framework
// verified 2026-06-05 against the framework reference implementation).
//
// Wire shapes per the framework spec:
//
//   library.list_works ->
//     { v:1, total, works: [WorkSummary] }
//
//   WorkSummary:
//     { work_id, composer, work, work_sort?, recording_count,
//       sources: [source_id] }
//
//   library.get_work_recordings (work_id) ->
//     { v:1, recordings: [Recording] }
//     ordered by original_date ascending (Conductor X/1962 before Conductor Y/1979)
//
//   Recording:
//     { recording_id, conductor, ensemble?, performer?, original_date,
//       recording_date?, label?, album_uri, track_count }
//
//   Refusal (unknown work_id):
//     { error: { class: "contract_violation",
//                message: "permanent error: library.get_work_recordings: ..." } }
//
// Plus the audio_library_state counter projection (live on the
// audio_library_state subject):
//   { total_tracks_with_composer, distinct_works,
//     works_with_multiple_recordings, ... }
//
// Truth-or-null per field (PLUGIN_CONTRACT.md §15). Missing/empty
// fields decode as null, not as fallback strings.

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

function stringListField(o: Record<string, unknown>, k: string): string[] {
  const v = o[k];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry === "string" && entry.length > 0) out.push(entry);
  }
  return out;
}

// --- WorkSummary (list_works) -----------------------------------

export interface WorkSummary {
  workId: string;
  composer: string;
  work: string;
  workSort: string | null;
  recordingCount: number;
  sources: string[];
}

export function decodeWorkSummary(raw: unknown): WorkSummary | null {
  if (!isObject(raw)) return null;
  const workId = stringField(raw, "work_id");
  const composer = stringField(raw, "composer");
  const work = stringField(raw, "work");
  if (workId === null || composer === null || work === null) return null;
  return {
    workId,
    composer,
    work,
    workSort: stringField(raw, "work_sort"),
    recordingCount: intField(raw, "recording_count") ?? 0,
    sources: stringListField(raw, "sources")
  };
}

export interface ListWorksResponse {
  total: number;
  works: WorkSummary[];
}

export function decodeListWorks(raw: unknown): ListWorksResponse | null {
  if (!isObject(raw)) return null;
  const worksRaw = raw["works"];
  const works: WorkSummary[] = [];
  if (Array.isArray(worksRaw)) {
    for (const entry of worksRaw) {
      const decoded = decodeWorkSummary(entry);
      if (decoded !== null) works.push(decoded);
    }
  }
  return { total: intField(raw, "total") ?? works.length, works };
}

// --- Recording (get_work_recordings) ----------------------------

export interface Recording {
  recordingId: string;
  conductor: string | null;
  ensemble: string | null;
  performer: string | null;
  originalDate: string | null;
  recordingDate: string | null;
  label: string | null;
  /** Framework's album_uri is the filesystem parent of contributing
   *  tracks (see framework spec finding #2). Used for "go to album"
   *  navigation in Library. NOT a human display label - use
   *  formatRecordingTitle for that. */
  albumUri: string | null;
  trackCount: number;
}

export function decodeRecording(raw: unknown): Recording | null {
  if (!isObject(raw)) return null;
  const recordingId = stringField(raw, "recording_id");
  if (recordingId === null) return null;
  return {
    recordingId,
    conductor: stringField(raw, "conductor"),
    ensemble: stringField(raw, "ensemble"),
    performer: stringField(raw, "performer"),
    originalDate: stringField(raw, "original_date"),
    recordingDate: stringField(raw, "recording_date"),
    label: stringField(raw, "label"),
    albumUri: stringField(raw, "album_uri"),
    trackCount: intField(raw, "track_count") ?? 0
  };
}

export interface GetWorkRecordingsResponse {
  recordings: Recording[];
}

export function decodeGetWorkRecordings(
  raw: unknown
): GetWorkRecordingsResponse | null {
  if (!isObject(raw)) return null;
  const recordingsRaw = raw["recordings"];
  const recordings: Recording[] = [];
  if (Array.isArray(recordingsRaw)) {
    for (const entry of recordingsRaw) {
      const decoded = decodeRecording(entry);
      if (decoded !== null) recordings.push(decoded);
    }
  }
  return { recordings };
}

// --- Refusal envelope -------------------------------------------

export interface WorksRefusal {
  errorClass: string;
  message: string;
}

/** Decode the framework's refusal envelope for an unknown work_id.
 *  Returns null if the value is not a recognisable refusal so the
 *  caller can distinguish "successful response" from "no-error" and
 *  "explicit-error" paths. */
export function decodeWorksRefusal(raw: unknown): WorksRefusal | null {
  if (!isObject(raw)) return null;
  const error = raw["error"];
  if (!isObject(error)) return null;
  const errorClass = stringField(error, "class");
  const message = stringField(error, "message");
  if (errorClass === null || message === null) return null;
  return { errorClass, message };
}

// --- audio_library_state counters --------------------------------

export interface LibraryCounters {
  totalTracksWithComposer: number;
  distinctWorks: number;
  worksWithMultipleRecordings: number;
}

/** Project the classical-aware counters out of an audio_library_state
 *  subject payload. Missing counters default to 0 (treated as "no
 *  classical content"). Returns null only when the input is not an
 *  object. */
export function decodeLibraryCounters(raw: unknown): LibraryCounters | null {
  if (!isObject(raw)) return null;
  return {
    totalTracksWithComposer: intField(raw, "total_tracks_with_composer") ?? 0,
    distinctWorks: intField(raw, "distinct_works") ?? 0,
    worksWithMultipleRecordings:
      intField(raw, "works_with_multiple_recordings") ?? 0
  };
}

// --- Display helpers --------------------------------------------

/** Per the framework spec finding #2: do NOT use album_uri basename
 *  as a recording's display name. Use (conductor, original_date,
 *  label) as the canonical recording title. Falls back gracefully
 *  when fields are null. Returns "Recording" if nothing usable. */
export function formatRecordingTitle(r: Recording): string {
  const parts: string[] = [];
  if (r.conductor !== null) parts.push(r.conductor);
  const year = pickYear(r.originalDate ?? r.recordingDate);
  if (year !== null) parts.push(`(${year})`);
  if (r.label !== null) parts.push(r.label);
  if (parts.length === 0) return "Recording";
  return parts.join(" - ");
}

/** Extract a 4-digit year from an ISO-ish date string. */
export function pickYear(raw: string | null): string | null {
  if (raw === null) return null;
  const m = /(\d{4})/.exec(raw);
  return m === null ? null : m[1];
}

/** Auto-mode resolution for the Works shelf. True iff the library
 *  contains at least one work with multiple recordings - the entire
 *  point of the shelf. */
export function autoShouldShowWorksShelf(c: LibraryCounters): boolean {
  return c.worksWithMultipleRecordings > 0;
}

/** True when the library has classical tracks but none of them are
 *  surfacing as works - the MP3-on-MPD-0.x limitation case. Drives
 *  the explanatory hint on an otherwise-empty Works surface. */
export function looksLikeMpdMp3Limitation(c: LibraryCounters): boolean {
  return c.totalTracksWithComposer > 0 && c.distinctWorks === 0;
}
