// Shared subscribe_happenings filter constants + helpers.
//
// The framework's subscribe_happenings op accepts an optional
// `filter` field with `subject_types` (allow-list) and
// `subject_types_deny` (deny-list) dimensions. Both apply only to
// subject_state_changed happenings; other variants (custody /
// lifecycle / claim / relation events) pass these dimensions
// trivially. See the framework reference implementation for the wire shape +
// CLIENT_API.md section 4.5 for the canonical contract.
//
// Why we deny audio_playback_spectrum_frame in non-visualiser
// consumers: that subject emits at ~30 Hz under playback and a
// catch-all subscribe would deliver every frame to every open
// browser tab, parsed and discarded by the wrong-subject path on
// each consumer. The deny filter keeps the framework's fan-out
// cost O(consumers actually interested) and keeps the browser
// from spending CPU on events it never renders. Verified live on
// the rig against the deployed the framework reference implementation binary.

/** Canonical subject_type name for the audio.terminus spectrum
 *  frames. Single source of truth - the framework's subject is
 *  `audio_playback_spectrum_frame` (see audio.terminus plugin's
 *  spectrum_subject.rs). */
export const SPECTRUM_SUBJECT_TYPE = "audio_playback_spectrum_frame";

/** Subscribe payload that denies the spectrum subject. Every
 *  hook that uses subscribe_happenings for state other than the
 *  visualiser should pass this as the second arg to
 *  transport.subscribe. */
export const DENY_SPECTRUM_PAYLOAD: Readonly<Record<string, unknown>> =
  Object.freeze({
    filter: Object.freeze({
      subject_types_deny: Object.freeze([SPECTRUM_SUBJECT_TYPE])
    })
  });

/** Subscribe payload that ALLOWS only the spectrum subject. The
 *  Visualiser consumer uses this so its WebSocket is not
 *  delivered every other subject_state_changed happening on the
 *  bus - tighter scope, less per-frame ignore cost. */
export const ALLOW_SPECTRUM_PAYLOAD: Readonly<Record<string, unknown>> =
  Object.freeze({
    filter: Object.freeze({
      subject_types: Object.freeze([SPECTRUM_SUBJECT_TYPE])
    })
  });
