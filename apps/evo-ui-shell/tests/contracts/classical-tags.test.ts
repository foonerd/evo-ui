// Contract tests for the shared classical-tags decoder.
//
// Pin the framework contract (audio.queue.v1 / audio.favourites.v1 /
// audio.playlist.v1 / audio.library.v1 / audio.playback.v1 + each
// shelf's `<shelf>-track-classical-metadata-fields-are-truth-or-null`
// acceptance row): missing/empty MPD tag emits as JSON null, decoder
// preserves null per-field, returns null at the struct level only
// when EVERY field is null.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classicalYear,
  decodeClassicalTags,
  type ClassicalTags
} from "../../src/features/classical/classical-tags.ts";

test("decodeClassicalTags returns null when every field is null", () => {
  // The non-classical case - the framework still emits the 13 fields
  // per the contract but they are all null and the UI elides the
  // enriched strip.
  const tags = decodeClassicalTags({
    composer: null,
    composer_sort: null,
    conductor: null,
    ensemble: null,
    performer: null,
    work: null,
    work_sort: null,
    movement: null,
    movement_number: null,
    original_date: null,
    recording_date: null,
    label: null,
    medium: null
  });
  assert.equal(tags, null);
});

test("decodeClassicalTags returns null when fields are absent (legacy envelope)", () => {
  // Defensive: an envelope from a pre-Section-A plugin would not even
  // have the keys. Decode still yields null at the struct level.
  assert.equal(decodeClassicalTags({}), null);
});

test("decodeClassicalTags returns the struct when at least one field is populated", () => {
  const tags = decodeClassicalTags({
    composer: "Composer A",
    composer_sort: "A, Composer",
    conductor: "Conductor X",
    ensemble: "Ensemble A",
    performer: null,
    work: "Work A",
    work_sort: null,
    movement: "I. Movement",
    movement_number: 1,
    original_date: "1974",
    recording_date: "1975-04-21",
    label: "Label A",
    medium: "CD"
  });
  assert.notEqual(tags, null);
  const t = tags as ClassicalTags;
  assert.equal(t.composer, "Composer A");
  assert.equal(t.conductor, "Conductor X");
  assert.equal(t.movementNumber, 1);
  assert.equal(t.label, "Label A");
});

test("decodeClassicalTags coerces an empty string to null", () => {
  // Framework normalises empty MPD tag values to None pre-wire, but
  // the decoder is defensive: an empty string is treated as null so
  // a partially-broken plugin cannot leak "" as known-empty.
  const tags = decodeClassicalTags({
    composer: "",
    conductor: "Conductor X",
    ensemble: "",
    work: null
  });
  assert.notEqual(tags, null);
  const t = tags as ClassicalTags;
  assert.equal(t.composer, null);
  assert.equal(t.conductor, "Conductor X");
  assert.equal(t.ensemble, null);
});

test("decodeClassicalTags coerces non-numeric movement_number to null", () => {
  const tags = decodeClassicalTags({
    composer: "Composer A",
    movement_number: "1"
  });
  const t = tags as ClassicalTags;
  assert.equal(t.movementNumber, null);
});

test("decodeClassicalTags returns null on a non-object input", () => {
  assert.equal(decodeClassicalTags(null), null);
  assert.equal(decodeClassicalTags(undefined), null);
  assert.equal(decodeClassicalTags("string"), null);
  assert.equal(decodeClassicalTags(42), null);
});

test("classicalYear prefers original_date over recording_date", () => {
  const tags: ClassicalTags = {
    composer: null,
    composerSort: null,
    conductor: null,
    ensemble: null,
    performer: null,
    work: null,
    workSort: null,
    movement: null,
    movementNumber: null,
    originalDate: "1962",
    recordingDate: "1977",
    label: null,
    medium: null
  };
  assert.equal(classicalYear(tags), "1962");
});

test("classicalYear extracts the 4-digit year from an ISO date", () => {
  const tags: ClassicalTags = {
    composer: null,
    composerSort: null,
    conductor: null,
    ensemble: null,
    performer: null,
    work: null,
    workSort: null,
    movement: null,
    movementNumber: null,
    originalDate: "1962-07-15",
    recordingDate: null,
    label: null,
    medium: null
  };
  assert.equal(classicalYear(tags), "1962");
});

test("classicalYear falls back to recording_date when original_date is null", () => {
  const tags: ClassicalTags = {
    composer: null,
    composerSort: null,
    conductor: null,
    ensemble: null,
    performer: null,
    work: null,
    workSort: null,
    movement: null,
    movementNumber: null,
    originalDate: null,
    recordingDate: "2016",
    label: null,
    medium: null
  };
  assert.equal(classicalYear(tags), "2016");
});

test("classicalYear returns null when both date fields are null", () => {
  const tags: ClassicalTags = {
    composer: "Composer A",
    composerSort: null,
    conductor: null,
    ensemble: null,
    performer: null,
    work: null,
    workSort: null,
    movement: null,
    movementNumber: null,
    originalDate: null,
    recordingDate: null,
    label: null,
    medium: null
  };
  assert.equal(classicalYear(tags), null);
});
