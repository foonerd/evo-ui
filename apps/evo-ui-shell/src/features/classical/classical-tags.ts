// Shared decoder for the 13 classical-metadata fields the framework
// projects onto every track-bearing wire envelope (audio.queue +
// audio.favourites + audio.playlist + audio.library file entries +
// audio.playback now-playing). Single source of truth so the
// projection cannot drift between shelves.
//
// Wire contract: each field is `T | null`, honouring the framework
// truth-or-null invariant (PLUGIN_CONTRACT.md §15). MPD tag absent or
// empty -> null on the wire -> null in the decoded struct. The decoder
// returns null at the struct level when every field is null - the
// "no classical metadata at all" case - so render sites do a single
// nullish check instead of probing each field.

export interface ClassicalTags {
  composer: string | null;
  composerSort: string | null;
  conductor: string | null;
  ensemble: string | null;
  performer: string | null;
  work: string | null;
  workSort: string | null;
  movement: string | null;
  movementNumber: number | null;
  originalDate: string | null;
  recordingDate: string | null;
  label: string | null;
  medium: string | null;
}

function stringOr(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOr(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Decode the 13 classical fields off any track-bearing envelope.
 *  Returns null when every field is null (the non-classical case, by
 *  far the most common - the framework still emits the fields per the
 *  contract but they are all null and the UI can elide the enriched
 *  strip entirely). */
export function decodeClassicalTags(raw: unknown): ClassicalTags | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tags: ClassicalTags = {
    composer: stringOr(o, "composer"),
    composerSort: stringOr(o, "composer_sort"),
    conductor: stringOr(o, "conductor"),
    ensemble: stringOr(o, "ensemble"),
    performer: stringOr(o, "performer"),
    work: stringOr(o, "work"),
    workSort: stringOr(o, "work_sort"),
    movement: stringOr(o, "movement"),
    movementNumber: intOr(o, "movement_number"),
    originalDate: stringOr(o, "original_date"),
    recordingDate: stringOr(o, "recording_date"),
    label: stringOr(o, "label"),
    medium: stringOr(o, "medium")
  };
  const anyPresent =
    tags.composer !== null ||
    tags.composerSort !== null ||
    tags.conductor !== null ||
    tags.ensemble !== null ||
    tags.performer !== null ||
    tags.work !== null ||
    tags.workSort !== null ||
    tags.movement !== null ||
    tags.movementNumber !== null ||
    tags.originalDate !== null ||
    tags.recordingDate !== null ||
    tags.label !== null ||
    tags.medium !== null;
  return anyPresent ? tags : null;
}

/** Pick the best "year" to surface in the operator strip - prefer
 *  original_date (audiophile-relevant year the recording was made)
 *  with recording_date as a fallback. Both are MPD strings and may
 *  contain a full ISO date like "1962-07-15" or just a year; pull
 *  the leading 4-digit year if present. */
export function classicalYear(tags: ClassicalTags): string | null {
  const raw = tags.originalDate ?? tags.recordingDate;
  if (raw === null) return null;
  const match = raw.match(/(\d{4})/);
  return match !== null ? match[1] : raw;
}
