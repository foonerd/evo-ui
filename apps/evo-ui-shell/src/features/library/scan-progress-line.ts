// scan-progress-line - what the source row says while a scan runs.
//
// The audio_library_scan_progress subject carries this source's
// `scanned_tracks` (songs already in the database under the mount)
// and the walker's `estimated_total`, or null when the walk missed
// its budget. A zero is not progress on the source row: "Indexing
// 0 of 142..." reads as nothing happening, so the row stays
// numberless until a real count arrives. The large heartbeat
// paints the moving count and bar. Settled trackCount paints
// after complete.
//
// Pure: the surface passes the entry, gets the line back; the contract
// harness drives every branch without a renderer.

import type { ScanProgressEntry } from "./library-decoders.ts";

export type ScanProgressLine =
  /** In flight, no real count yet: a line with no number. */
  | { key: "library.indexingUnderway" }
  /** In flight with a real count and a total. */
  | { key: "library.indexingOf"; scanned: number; total: number }
  /** In flight with a real count, no total (walker missed). */
  | { key: "library.indexing"; scanned: number }
  /** Nothing in flight for this source: paint the settled counts. */
  | null;

export function scanProgressLine(
  entry: ScanProgressEntry | undefined
): ScanProgressLine {
  if (entry === undefined || entry.phase !== "scanning") return null;
  if (!(entry.scannedTracks > 0)) {
    return { key: "library.indexingUnderway" };
  }
  if (entry.estimatedTotal !== null && entry.estimatedTotal > 0) {
    return {
      key: "library.indexingOf",
      scanned: entry.scannedTracks,
      total: entry.estimatedTotal
    };
  }
  return { key: "library.indexing", scanned: entry.scannedTracks };
}

/** First in-flight retract across the admitted stores, or null.
 *  Remove of SMB/NFS/USB-catalogue rides the same subject as
 *  index so the heartbeat is the truth of a behind-the-scenes
 *  retract. */
export function libraryRetractHeartbeat(
  sources: readonly { id: string; displayName: string }[] | null,
  scanProgress: Record<string, ScanProgressEntry>
): LibraryRetractHeartbeatModel | null {
  if (sources === null) return null;
  for (const source of sources) {
    const entry = scanProgress[source.id];
    if (entry === undefined || entry.phase !== "retracting") continue;
    return { name: source.displayName };
  }
  for (const [id, entry] of Object.entries(scanProgress)) {
    if (entry.phase !== "retracting") continue;
    return { name: id };
  }
  return null;
}

export interface LibraryRetractHeartbeatModel {
  name: string;
}

/** First in-flight scan across the admitted stores, or null. */
export function libraryScanHeartbeat(
  sources: readonly { id: string; displayName: string }[] | null,
  scanProgress: Record<string, ScanProgressEntry>
): LibraryScanHeartbeatModel | null {
  if (sources === null) return null;
  for (const source of sources) {
    const entry = scanProgress[source.id];
    if (entry === undefined || entry.phase !== "scanning") continue;
    return {
      name: source.displayName,
      scanned: entry.scannedTracks,
      total: entry.estimatedTotal !== null && entry.estimatedTotal > 0
        ? entry.estimatedTotal
        : null,
      startedAtMs: entry.startedAtMs
    };
  }
  return null;
}

export interface LibraryScanHeartbeatModel {
  name: string;
  scanned: number;
  total: number | null;
  startedAtMs: number | null;
}

/** 0..1 when a denominator exists; null when the walker missed. */
export function scanProgressRatio(
  scanned: number,
  total: number | null
): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(1, Math.max(0, scanned / total));
}

/** Operator elapsed, from the scan's start. */
export function scanElapsedLabel(startedAtMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
