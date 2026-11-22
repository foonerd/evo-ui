// play-history - pure decoders for the two library history reads.
//
// library.recently_played answers { v, plays: [{ uri, finished_at }],
// cap }; library.most_played answers { v, tracks: [{ uri, count,
// last_finished_at }] }. The glass shows what the answer carries: a
// recent row is the URI and when it finished (newest first; the same
// track can appear twice), a most-played row is the URI and its count
// (highest first; a count of zero is not shown). A row's URI is the
// same library-relative form a browse file entry carries, so the
// existing play of that URI applies to it unchanged. Nothing here
// fetches a title.

export interface PlayRecord {
  uri: string;
  /** Seconds since the Unix epoch when the track finished. */
  finishedAt: number;
}

export interface PlayCount {
  uri: string;
  /** Finished plays; always at least one. */
  count: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Decode the recently_played answer, or null when it carries no
 *  plays list. Unusable rows are dropped. Newest first. */
export function decodeRecentlyPlayed(raw: unknown): PlayRecord[] | null {
  if (!isObject(raw)) return null;
  const plays = raw["plays"];
  if (!Array.isArray(plays)) return null;
  const rows: PlayRecord[] = [];
  for (const p of plays) {
    if (!isObject(p)) continue;
    const uri = p["uri"];
    const finishedAt = p["finished_at"];
    if (!nonEmptyString(uri) || !finiteNumber(finishedAt)) continue;
    rows.push({ uri, finishedAt });
  }
  return rows.sort((a, b) => b.finishedAt - a.finishedAt);
}

/** Decode the most_played answer, or null when it carries no tracks
 *  list. A count of zero is not a play and is not shown. Highest
 *  count first; ties keep the answer's order. */
export function decodeMostPlayed(raw: unknown): PlayCount[] | null {
  if (!isObject(raw)) return null;
  const tracks = raw["tracks"];
  if (!Array.isArray(tracks)) return null;
  const rows: PlayCount[] = [];
  for (const c of tracks) {
    if (!isObject(c)) continue;
    const uri = c["uri"];
    const count = c["count"];
    if (!nonEmptyString(uri) || !finiteNumber(count) || count <= 0) continue;
    rows.push({ uri, count });
  }
  return rows.sort((a, b) => b.count - a.count);
}

/** When a play finished, in the operator's local time. */
export function formatFinishedAt(finishedAt: number): string {
  return new Date(finishedAt * 1000).toLocaleString();
}
