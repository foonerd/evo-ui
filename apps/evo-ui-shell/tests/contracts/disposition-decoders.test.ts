// Contract tests for the audio_playback_disposition decoders.
// Wire shapes per evo-plugin-sdk/src/contract/disposition.rs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeDispositionEntry,
  decodeDispositionState,
  decodeDispositionStateHappening,
  describeRecoveryHint,
  formatClockTime,
  formatDispositionKind
} from "../../src/features/activity/disposition-decoders.ts";

// --- decodeDispositionEntry --------------------------------------

test("decodeDispositionEntry decodes a single track-skipped-source-offline event", () => {
  const e = decodeDispositionEntry({
    v: 1,
    at_ms: 1780506213000,
    kind: { kind: "track_skipped_source_offline" },
    action_taken: { kind: "skip_forward" },
    queue_position: 12,
    track_uri: "INTERNAL/Artist A/track.mp3",
    source_id: "nas-livingroom",
    recovery_hint: {
      kind: "wake_source",
      source_id: "nas-livingroom"
    }
  });
  assert.equal(e?.kind, "track_skipped_source_offline");
  assert.equal(e?.action, "skip_forward");
  assert.equal(e?.queuePosition, 12);
  assert.equal(e?.trackUri, "INTERNAL/Artist A/track.mp3");
  assert.equal(e?.sourceId, "nas-livingroom");
  assert.equal(e?.recoveryHint?.kind, "wake_source");
  if (e?.recoveryHint?.kind === "wake_source") {
    assert.equal(e.recoveryHint.sourceId, "nas-livingroom");
  }
});

test("decodeDispositionEntry decodes a coalesced tracks-skipped-run", () => {
  const e = decodeDispositionEntry({
    at_ms: 1780506214000,
    kind: { kind: "tracks_skipped_run" },
    action_taken: { kind: "skip_forward" },
    source_id: "nas-livingroom",
    runs: { count: 3, from_position: 12, to_position: 14 },
    recovery_hint: { kind: "wake_source", source_id: "nas-livingroom" }
  });
  assert.equal(e?.kind, "tracks_skipped_run");
  assert.equal(e?.run?.count, 3);
  assert.equal(e?.run?.fromPosition, 12);
  assert.equal(e?.run?.toPosition, 14);
});

test("decodeDispositionEntry decodes queue-exhausted with no recovery hint", () => {
  const e = decodeDispositionEntry({
    at_ms: 1780506215000,
    kind: { kind: "queue_exhausted_no_playable" },
    action_taken: { kind: "stop" }
  });
  assert.equal(e?.kind, "queue_exhausted_no_playable");
  assert.equal(e?.action, "stop");
  assert.equal(e?.recoveryHint, null);
});

test("decodeDispositionEntry decodes inspect_track recovery hint", () => {
  const e = decodeDispositionEntry({
    at_ms: 1780506216000,
    kind: { kind: "track_skipped_decoder_failure" },
    action_taken: { kind: "skip_forward" },
    track_uri: "INTERNAL/broken.flac",
    recovery_hint: { kind: "inspect_track", uri: "INTERNAL/broken.flac" }
  });
  assert.equal(e?.recoveryHint?.kind, "inspect_track");
  if (e?.recoveryHint?.kind === "inspect_track") {
    assert.equal(e.recoveryHint.uri, "INTERNAL/broken.flac");
  }
});

test("decodeDispositionEntry maps unknown kinds to 'other'", () => {
  const e = decodeDispositionEntry({
    at_ms: 1780506217000,
    kind: { kind: "future_disposition_type" },
    action_taken: { kind: "newfangled_action" }
  });
  assert.equal(e?.kind, "other");
  assert.equal(e?.action, "other");
});

test("decodeDispositionEntry rejects missing at_ms", () => {
  assert.equal(
    decodeDispositionEntry({
      kind: { kind: "queue_exhausted_no_playable" },
      action_taken: { kind: "stop" }
    }),
    null
  );
});

// --- decodeDispositionState --------------------------------------

test("decodeDispositionState decodes the ring-buffer envelope", () => {
  const state = decodeDispositionState({
    v: 1,
    dispositions: [
      {
        at_ms: 1780506213000,
        kind: { kind: "queue_exhausted_no_playable" },
        action_taken: { kind: "stop" }
      },
      {
        at_ms: 1780506214000,
        kind: { kind: "track_skipped_source_offline" },
        action_taken: { kind: "skip_forward" },
        source_id: "nas",
        recovery_hint: { kind: "wake_source", source_id: "nas" }
      }
    ]
  });
  assert.equal(state?.dispositions.length, 2);
});

test("decodeDispositionState decodes an empty ring", () => {
  const state = decodeDispositionState({ v: 1, dispositions: [] });
  assert.equal(state?.dispositions.length, 0);
});

test("decodeDispositionStateHappening decodes a subject_state_changed for audio_playback_disposition", () => {
  const state = decodeDispositionStateHappening({
    type: "subject_state_changed",
    subject_type: "audio_playback_disposition",
    new_state: { v: 1, dispositions: [] }
  });
  assert.equal(state?.dispositions.length, 0);
});

test("decodeDispositionStateHappening ignores other subjects", () => {
  assert.equal(
    decodeDispositionStateHappening({
      type: "subject_state_changed",
      subject_type: "audio_queue",
      new_state: {}
    }),
    null
  );
});

// --- helpers -----------------------------------------------------

test("formatDispositionKind renders the expected operator-facing labels", () => {
  assert.equal(
    formatDispositionKind("track_skipped_source_offline"),
    "Track skipped: source offline"
  );
  assert.equal(
    formatDispositionKind("queue_exhausted_no_playable"),
    "Queue exhausted - no playable items"
  );
  assert.equal(
    formatDispositionKind("tracks_skipped_run"),
    "Tracks skipped (coalesced run)"
  );
});

test("describeRecoveryHint maps each variant to its label + payload", () => {
  const wake = describeRecoveryHint({
    kind: "wake_source",
    sourceId: "nas"
  });
  assert.deepEqual(wake, {
    label: "Wake source",
    payload: { source_id: "nas" }
  });
  const inspect = describeRecoveryHint({
    kind: "inspect_track",
    uri: "INTERNAL/x.mp3"
  });
  assert.deepEqual(inspect, {
    label: "Inspect track",
    payload: { uri: "INTERNAL/x.mp3" }
  });
  const add = describeRecoveryHint({ kind: "add_playable_track" });
  assert.deepEqual(add, { label: "Add tracks", payload: {} });
});

test("formatClockTime renders a stable HH:MM:SS string", () => {
  // Use a known timestamp - the formatter uses the local
  // timezone, so we just assert shape rather than exact value.
  const out = formatClockTime(1780506213000);
  assert.match(out, /^\d{2}:\d{2}:\d{2}$/);
});
