// Contract tests for the Works decoders.
//
// Wire shapes pinned against the framework spec - the live
// happy/refusal envelopes for library.list_works and
// library.get_work_recordings, plus the audio_library_state counter
// projection.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  autoShouldShowWorksShelf,
  decodeGetWorkRecordings,
  decodeLibraryCounters,
  decodeListWorks,
  decodeRecording,
  decodeWorkSummary,
  decodeWorksRefusal,
  formatRecordingTitle,
  looksLikeMpdMp3Limitation,
  pickYear,
  type Recording
} from "../../src/features/works/works-decoders.ts";

// --- decodeWorkSummary -------------------------------------------

test("decodeWorkSummary decodes the multi-recording closure case", () => {
  const w = decodeWorkSummary({
    work_id: "16197ea6bd8139b4",
    composer: "Composer A",
    work: "Work A",
    recording_count: 2,
    sources: ["src-a"]
  });
  assert.notEqual(w, null);
  assert.equal(w?.workId, "16197ea6bd8139b4");
  assert.equal(w?.composer, "Composer A");
  assert.equal(w?.work, "Work A");
  assert.equal(w?.workSort, null);
  assert.equal(w?.recordingCount, 2);
  assert.deepEqual(w?.sources, ["src-a"]);
});

test("decodeWorkSummary rejects a row missing work_id / composer / work", () => {
  assert.equal(decodeWorkSummary({ composer: "X", work: "Y" }), null);
  assert.equal(
    decodeWorkSummary({ work_id: "a", work: "Y", composer: null }),
    null
  );
  assert.equal(
    decodeWorkSummary({ work_id: "a", composer: "X", work: "" }),
    null
  );
});

test("decodeWorkSummary defaults recording_count to 0 when absent", () => {
  const w = decodeWorkSummary({
    work_id: "a",
    composer: "X",
    work: "Y"
  });
  assert.equal(w?.recordingCount, 0);
  assert.deepEqual(w?.sources, []);
});

// --- decodeListWorks ---------------------------------------------

test("decodeListWorks decodes the closure-verified payload", () => {
  const r = decodeListWorks({
    v: 1,
    total: 1,
    works: [
      {
        work_id: "16197ea6bd8139b4",
        composer: "Composer A",
        work: "Work A",
        recording_count: 2,
        sources: ["src-a"]
      }
    ]
  });
  assert.notEqual(r, null);
  assert.equal(r?.total, 1);
  assert.equal(r?.works.length, 1);
  assert.equal(r?.works[0].recordingCount, 2);
});

test("decodeListWorks drops bad rows without failing the envelope", () => {
  const r = decodeListWorks({
    v: 1,
    total: 2,
    works: [
      {
        work_id: "good",
        composer: "C",
        work: "W"
      },
      { composer: "missing work_id and work" }
    ]
  });
  assert.equal(r?.works.length, 1);
  assert.equal(r?.works[0].workId, "good");
});

// --- decodeRecording ---------------------------------------------

test("decodeRecording decodes the Conductor X/1962 closure recording", () => {
  const r = decodeRecording({
    recording_id: "ddd0c425da694d3e",
    conductor: "Conductor X",
    ensemble: "Ensemble A",
    original_date: "1962",
    label: "Label A",
    album_uri: "src-a/album-c",
    track_count: 4
  });
  assert.notEqual(r, null);
  assert.equal(r?.recordingId, "ddd0c425da694d3e");
  assert.equal(r?.conductor, "Conductor X");
  assert.equal(r?.ensemble, "Ensemble A");
  assert.equal(r?.originalDate, "1962");
  assert.equal(r?.label, "Label A");
  assert.equal(r?.albumUri, "src-a/album-c");
  assert.equal(r?.trackCount, 4);
  // Missing optional fields decode as null, not undefined / empty.
  assert.equal(r?.performer, null);
  assert.equal(r?.recordingDate, null);
});

test("decodeRecording rejects an entry missing recording_id", () => {
  assert.equal(
    decodeRecording({ conductor: "X", original_date: "1962" }),
    null
  );
});

test("decodeRecording preserves null for absent / empty optional fields", () => {
  const r = decodeRecording({
    recording_id: "x",
    conductor: "",
    ensemble: null,
    original_date: "1979"
  });
  assert.notEqual(r, null);
  assert.equal(r?.conductor, null);
  assert.equal(r?.ensemble, null);
  assert.equal(r?.originalDate, "1979");
  assert.equal(r?.albumUri, null);
});

// --- decodeGetWorkRecordings -------------------------------------

test("decodeGetWorkRecordings preserves the original_date ordering", () => {
  // The framework returns recordings ordered by original_date
  // ascending (framework spec). The decoder MUST preserve that order -
  // it never re-sorts.
  const r = decodeGetWorkRecordings({
    v: 1,
    recordings: [
      {
        recording_id: "ddd0c425da694d3e",
        conductor: "Conductor X",
        original_date: "1962",
        album_uri: "src-a/album-c"
      },
      {
        recording_id: "7c6bfa489a2d2a59",
        conductor: "Conductor Y",
        original_date: "1979",
        album_uri: "src-a/album-d"
      }
    ]
  });
  assert.equal(r?.recordings.length, 2);
  assert.equal(r?.recordings[0].conductor, "Conductor X");
  assert.equal(r?.recordings[0].originalDate, "1962");
  assert.equal(r?.recordings[1].conductor, "Conductor Y");
  assert.equal(r?.recordings[1].originalDate, "1979");
});

// --- decodeWorksRefusal ------------------------------------------

test("decodeWorksRefusal decodes the closure-verified refusal envelope", () => {
  const r = decodeWorksRefusal({
    error: {
      class: "contract_violation",
      message:
        'permanent error: library.get_work_recordings: work_id "bogusbogusbogus0" not found in the current aggregate'
    }
  });
  assert.notEqual(r, null);
  assert.equal(r?.errorClass, "contract_violation");
  assert.match(r?.message ?? "", /work_id "bogusbogusbogus0" not found/);
});

test("decodeWorksRefusal returns null for a non-refusal envelope", () => {
  assert.equal(decodeWorksRefusal({ v: 1, recordings: [] }), null);
  assert.equal(decodeWorksRefusal(null), null);
  assert.equal(decodeWorksRefusal({ error: "string-not-object" }), null);
});

// --- decodeLibraryCounters ---------------------------------------

test("decodeLibraryCounters projects the three classical counters", () => {
  const c = decodeLibraryCounters({
    total_tracks: 1135,
    total_tracks_with_composer: 450,
    distinct_works: 1,
    works_with_multiple_recordings: 1
  });
  assert.notEqual(c, null);
  assert.equal(c?.totalTracksWithComposer, 450);
  assert.equal(c?.distinctWorks, 1);
  assert.equal(c?.worksWithMultipleRecordings, 1);
});

test("decodeLibraryCounters defaults missing counters to 0", () => {
  const c = decodeLibraryCounters({});
  assert.notEqual(c, null);
  assert.equal(c?.totalTracksWithComposer, 0);
  assert.equal(c?.distinctWorks, 0);
  assert.equal(c?.worksWithMultipleRecordings, 0);
});

// --- formatRecordingTitle / pickYear -----------------------------

test("formatRecordingTitle composes (conductor) (year) - label", () => {
  const r: Recording = {
    recordingId: "x",
    conductor: "Conductor X",
    ensemble: null,
    performer: null,
    originalDate: "1962",
    recordingDate: null,
    label: "Label A",
    albumUri: "src-a/album-c",
    trackCount: 4
  };
  assert.equal(
    formatRecordingTitle(r),
    "Conductor X - (1962) - Label A"
  );
});

test("formatRecordingTitle falls back gracefully when fields are null", () => {
  const r: Recording = {
    recordingId: "x",
    conductor: null,
    ensemble: null,
    performer: null,
    originalDate: null,
    recordingDate: null,
    label: null,
    albumUri: "anything",
    trackCount: 1
  };
  assert.equal(formatRecordingTitle(r), "Recording");
});

test("pickYear extracts the first 4-digit run from common date shapes", () => {
  assert.equal(pickYear("1962"), "1962");
  assert.equal(pickYear("1979-09"), "1979");
  assert.equal(pickYear("circa 1845"), "1845");
  assert.equal(pickYear(null), null);
  assert.equal(pickYear(""), null);
});

// --- Auto-mode + MP3-limitation helpers --------------------------

test("autoShouldShowWorksShelf gates on works_with_multiple_recordings", () => {
  assert.equal(
    autoShouldShowWorksShelf({
      totalTracksWithComposer: 100,
      distinctWorks: 5,
      worksWithMultipleRecordings: 0
    }),
    false
  );
  assert.equal(
    autoShouldShowWorksShelf({
      totalTracksWithComposer: 100,
      distinctWorks: 5,
      worksWithMultipleRecordings: 1
    }),
    true
  );
});

test("looksLikeMpdMp3Limitation flags the MP3-tagged-but-no-works case", () => {
  // MP3 library with composer tags but no Work tags MPD can read.
  assert.equal(
    looksLikeMpdMp3Limitation({
      totalTracksWithComposer: 450,
      distinctWorks: 0,
      worksWithMultipleRecordings: 0
    }),
    true
  );
  // FLAC library with Work tags - not the limitation case.
  assert.equal(
    looksLikeMpdMp3Limitation({
      totalTracksWithComposer: 450,
      distinctWorks: 17,
      worksWithMultipleRecordings: 3
    }),
    false
  );
  // No classical content at all - also not the limitation case.
  assert.equal(
    looksLikeMpdMp3Limitation({
      totalTracksWithComposer: 0,
      distinctWorks: 0,
      worksWithMultipleRecordings: 0
    }),
    false
  );
});
