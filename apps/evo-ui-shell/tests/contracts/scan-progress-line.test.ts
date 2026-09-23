// Contract: "Indexing 0 of M" is not progress.
//
// The scan-progress subject carries scanned_tracks as the in-flight
// zero while a scan runs (the plugin does not count per tick) and the
// walker's estimated_total. The source row used to paint that as
// "Indexing 0 of 142..." - a number that reads as nothing happening.
// While the count is zero the line has no number; a real count keeps
// the existing strings; a completed scan paints the settled counts.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  libraryRetractHeartbeat,
  libraryScanHeartbeat,
  scanElapsedLabel,
  scanProgressLine,
  scanProgressRatio
} from "../../src/features/library/scan-progress-line.ts";
import { decodeScanProgressHappening } from "../../src/features/library/library-decoders.ts";

const scanning = (scannedTracks: number, estimatedTotal: number | null) => ({
  sourceId: "local-internal",
  kind: "rescan",
  scannedTracks,
  estimatedTotal,
  startedAtMs: 1_700_000_000_000,
  phase: "scanning" as const
});

test("scanning with the in-flight zero and a total -> numberless Indexing, never 0 of M", () => {
  assert.deepEqual(scanProgressLine(scanning(0, 142)), { key: "library.indexingUnderway" });
});

test("scanning with the in-flight zero and no total -> numberless Indexing, never Indexing 0", () => {
  assert.deepEqual(scanProgressLine(scanning(0, null)), { key: "library.indexingUnderway" });
});

test("scanning with a real count and a total keeps Indexing N of M", () => {
  assert.deepEqual(scanProgressLine(scanning(37, 142)), {
    key: "library.indexingOf",
    scanned: 37,
    total: 142
  });
});

test("scanning with a real count and no total keeps Indexing N", () => {
  assert.deepEqual(scanProgressLine(scanning(37, null)), { key: "library.indexing", scanned: 37 });
  // A zero total is no total either: never "37 of 0".
  assert.deepEqual(scanProgressLine(scanning(37, 0)), { key: "library.indexing", scanned: 37 });
});

test("a completed scan paints nothing here - the settled counts take over", () => {
  assert.equal(scanProgressLine({ ...scanning(0, 142), phase: "complete" }), null);
  assert.equal(scanProgressLine(undefined), null);
});

test("today's wire decodes to the in-flight zero and lands on the numberless line", () => {
  const frame = {
    type: "subject_state_changed",
    subject_type: "audio_library_scan_progress",
    new_state: {
      v: 1,
      scans: [
        {
          source_id: "local-internal",
          kind: "rescan",
          started_at_ms: 1,
          scanned_tracks: 0,
          estimated_total: 142,
          phase: "scanning"
        }
      ]
    }
  };
  const scans = decodeScanProgressHappening(frame);
  assert.ok(scans !== null && scans.length === 1);
  assert.deepEqual(scanProgressLine(scans[0]), { key: "library.indexingUnderway" });
});

// ---- the surface and the locale ----------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

test("LibrarySurface paints the scan line through scanProgressLine, not the raw zero", () => {
  const surface = src("features/library/LibrarySurface.tsx");
  assert.ok(/scanProgressLine\(library\.scanProgress\[source\.id\]\)/.test(surface));
  assert.ok(/t\("library\.indexingUnderway"\)/.test(surface), "the numberless line is wired");
  assert.ok(
    !/t\("library\.indexingOf",\s*\{\s*scanned: sp\.scannedTracks/.test(surface),
    "no direct paint of the wire count"
  );
  assert.ok(/library\.tracksOfTotal/.test(surface), "settled counts still paint after complete");
});

test("a retracting share is a large heartbeat, not a silent drop", () => {
  const retracting = {
    sourceId: "nas-smb",
    kind: "remove",
    scannedTracks: 0,
    estimatedTotal: null,
    startedAtMs: 1,
    phase: "retracting" as const
  };
  assert.deepEqual(
    libraryRetractHeartbeat([{ id: "nas-smb", displayName: "SMB" }], {
      "nas-smb": retracting
    }),
    { name: "SMB" }
  );
  assert.equal(libraryRetractHeartbeat([{ id: "nas-smb", displayName: "SMB" }], {}), null);
  const frame = {
    type: "subject_state_changed",
    subject_type: "audio_library_scan_progress",
    new_state: {
      v: 1,
      scans: [
        {
          source_id: "nas-smb",
          kind: "remove",
          phase: "retracting",
          scanned_tracks: 0
        }
      ]
    }
  };
  const scans = decodeScanProgressHappening(frame);
  assert.ok(scans !== null && scans.length === 1 && scans[0].phase === "retracting");
  const surface = src("features/library/LibrarySurface.tsx");
  assert.match(surface, /libraryRetractHeartbeat\(/);
  assert.match(surface, /LibraryRetractHeartbeat/);
  const en = src("locales/en.ts");
  assert.match(en, /"library\.heartbeat\.removing":\s*"Removing \{name\}"/);
  assert.match(en, /"library\.removeStageRetract":\s*"Updating the library"/);
});

test("an in-flight scan is a large heartbeat with a moving count", () => {
  const beat = libraryScanHeartbeat(
    [{ id: "nas-a", displayName: "NFS" }],
    { "nas-a": scanning(1240, 12000) }
  );
  assert.deepEqual(beat, {
    name: "NFS",
    scanned: 1240,
    total: 12000,
    startedAtMs: 1_700_000_000_000
  });
  assert.equal(scanProgressRatio(1240, 12000), 1240 / 12000);
  assert.equal(scanProgressRatio(0, null), null);
  assert.equal(scanElapsedLabel(0, 65_000), "1:05");
  assert.equal(scanElapsedLabel(0, 3_600_000 + 120_000), "1h 02m");
  assert.equal(libraryScanHeartbeat([{ id: "nas-a", displayName: "NFS" }], {}), null);
  const surface = src("features/library/LibrarySurface.tsx");
  assert.match(surface, /libraryScanHeartbeat\(/);
  assert.match(surface, /LibraryScanHeartbeat/);
  const en = src("locales/en.ts");
  assert.match(en, /"library\.heartbeat\.indexing":\s*"Indexing \{name\}"/);
  assert.match(en, /"library\.heartbeat\.elapsed":\s*"\{elapsed\} elapsed"/);
});

test("the numberless key exists and carries no placeholder", () => {
  const en = src("locales/en.ts");
  const m = /"library\.indexingUnderway":\s*"([^"]*)"/.exec(en);
  assert.ok(m !== null, "library.indexingUnderway is in en.ts");
  assert.ok(!/\{/.test(m![1]), "no {scanned} / {total} placeholder");
  assert.ok(/^[\x20-\x7E]+$/.test(m![1]), "7-bit ASCII copy");
  // The counted strings stay for a wire that counts.
  assert.ok(/"library\.indexingOf":\s*"Indexing \{scanned\} of \{total\}\.\.\."/.test(en));
  assert.ok(/"library\.indexing":\s*"Indexing \{scanned\}\.\.\."/.test(en));
});
