// Contract tests for the audio.options shape-2 decoders + the
// mixer-transition state reducer.
//
// Maps to the options.v2 contract's UI-side acceptance criteria
// T1-T8 (the audio-options delivery brief). Each test synthesises
// the happening / wire payload the framework emits and asserts the
// decoded shape, so the affordance behaviour is verifiable without
// the deployed shape-2 plugin.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeAudioOptionsSettings,
  clampCrossfadeSeconds,
  CROSSFADE_SECONDS_MAX,
  buildTestTonePayload,
  TEST_TONE_FREQ_MAX,
  TEST_TONE_DURATION_MIN_MS,
  decodeResamplingPolicy,
  decodeMixerTransitionEvent,
  decodeAlsaOutputs,
  visibleOutputs,
  findSelectedOutput,
  decodeActiveDacConfig,
  decodeDacCatalogue,
  decodeDspCapabilities,
  decodeDacRebootRequired,
  decodePluginNames,
  classifyPowerVerbOutcome,
  decodeModderSurface,
  decodeCatalogueProfile,
  decodeVerifyInstallReport,
  extractPluginEvent,
  reduceMixerTransition,
  isTransitionInFlight,
  IDLE_TRANSITION,
  MIXER_TRANSITION_EVENT_TYPES,
  type MixerTransitionPhase
} from "../../src/features/audio/audio-options-decoders.ts";
import { sha256Hex } from "../../src/runtime/sha256.ts";

// --- T6: startup restore (decode audio.options.settings) ---------

test("T6 decodeAudioOptionsSettings restores mixer_device + mixer_control when present", () => {
  const s = decodeAudioOptionsSettings({
    v: 1,
    mixer_type: "hardware",
    mixer_device: "hw:CARD=DAC",
    mixer_control: "Master",
    startup_volume_percent: 25,
    max_volume_percent: 80,
    volume_curve: "log"
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.mixerType, "hardware");
  assert.equal(s.mixerDevice, "hw:CARD=DAC");
  assert.equal(s.mixerControl, "Master");
  assert.equal(s.startupVolumePercent, 25);
  assert.equal(s.maxVolumePercent, 80);
  assert.equal(s.volumeCurve, "log");
});

test("decodeAudioOptionsSettings maps missing fields to framework defaults", () => {
  const s = decodeAudioOptionsSettings({ v: 1 });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.mixerType, "software");
  assert.equal(s.mixerDevice, "");
  assert.equal(s.mixerControl, "");
  assert.equal(s.startupVolumePercent, 30);
  assert.equal(s.maxVolumePercent, 100);
  assert.equal(s.volumeCurve, "linear");
  // Exclusive mode / crossfade / gapless default to off / 0 / true.
  assert.equal(s.exclusiveMode, false);
  assert.equal(s.crossfadeSeconds, 0);
  assert.equal(s.gapless, true);
});

test("decodeAudioOptionsSettings restores exclusive_mode, crossfade_seconds, gapless", () => {
  const s = decodeAudioOptionsSettings({
    v: 1,
    exclusive_mode: true,
    crossfade_seconds: 8,
    gapless: false
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.exclusiveMode, true);
  assert.equal(s.crossfadeSeconds, 8);
  assert.equal(s.gapless, false);
});

test("decodeAudioOptionsSettings clamps crossfade_seconds into 0..=30", () => {
  const hi = decodeAudioOptionsSettings({ crossfade_seconds: 999 });
  const lo = decodeAudioOptionsSettings({ crossfade_seconds: -4 });
  assert.equal(hi?.crossfadeSeconds, CROSSFADE_SECONDS_MAX);
  assert.equal(lo?.crossfadeSeconds, 0);
});

test("clampCrossfadeSeconds rounds and bounds; non-numeric falls back to 0", () => {
  assert.equal(clampCrossfadeSeconds(12.6), 13);
  assert.equal(clampCrossfadeSeconds(40), CROSSFADE_SECONDS_MAX);
  assert.equal(clampCrossfadeSeconds(-1), 0);
  assert.equal(clampCrossfadeSeconds("nope"), 0);
  assert.equal(clampCrossfadeSeconds(NaN), 0);
});

// --- buildTestTonePayload ----------------------------------------

test("buildTestTonePayload passes valid values through", () => {
  const p = buildTestTonePayload(440, 800, "left");
  assert.deepEqual(p, {
    v: 1,
    freq_hz: 440,
    duration_ms: 800,
    channel: "left"
  });
});

test("buildTestTonePayload clamps frequency and duration to the framework domains", () => {
  const hi = buildTestTonePayload(999999, 999999, "both");
  assert.equal(hi.freq_hz, TEST_TONE_FREQ_MAX);
  assert.equal(hi.duration_ms, 10000);
  const lo = buildTestTonePayload(1, 1, "both");
  assert.equal(lo.freq_hz, 20);
  assert.equal(lo.duration_ms, TEST_TONE_DURATION_MIN_MS);
});

test("buildTestTonePayload falls back to both for an unknown channel", () => {
  const p = buildTestTonePayload(1000, 1500, "centre" as never);
  assert.equal(p.channel, "both");
});

test("buildTestTonePayload rounds non-integer freq / duration", () => {
  const p = buildTestTonePayload(1000.7, 1500.4, "right");
  assert.equal(p.freq_hz, 1001);
  assert.equal(p.duration_ms, 1500);
});

test("decodeAudioOptionsSettings clamps out-of-domain volume percents", () => {
  const s = decodeAudioOptionsSettings({
    startup_volume_percent: 250,
    max_volume_percent: -5
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.startupVolumePercent, 100);
  assert.equal(s.maxVolumePercent, 0);
});

test("decodeAudioOptionsSettings rejects a non-object payload", () => {
  assert.equal(decodeAudioOptionsSettings(undefined), null);
  assert.equal(decodeAudioOptionsSettings("settings"), null);
  assert.equal(decodeAudioOptionsSettings([]), null);
});

test("decodeAudioOptionsSettings coerces an unknown mixer_type to software", () => {
  const s = decodeAudioOptionsSettings({ mixer_type: "quantum" });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.mixerType, "software");
});

test("decodeAudioOptionsSettings decodes the bound output device", () => {
  const s = decodeAudioOptionsSettings({ v: 1, output_device: "hw:CARD=DAC" });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.outputDevice, "hw:CARD=DAC");
});

test("decodeAudioOptionsSettings defaults a missing output_device to empty", () => {
  const s = decodeAudioOptionsSettings({ v: 1 });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.outputDevice, "");
});

// --- T1/T2/T7: effective_level carried on the applied happening --

test("T1 decodeMixerTransitionEvent applied carries carried + effective levels distinctly", () => {
  const ev = decodeMixerTransitionEvent(MIXER_TRANSITION_EVENT_TYPES.applied, {
    v: 1,
    from: "software",
    to: "hardware",
    carried_level: 30,
    effective_level: 25
  });
  assert.notEqual(ev, null);
  if (ev === null || ev.kind !== "applied") {
    assert.fail("expected applied event");
    return;
  }
  assert.equal(ev.carriedLevel, 30);
  assert.equal(ev.effectiveLevel, 25);
});

test("T7 reducer applied phase exposes effectiveLevel as the slider authority", () => {
  // The surface reads effectiveLevel off the applied phase and snaps
  // the volume slider to it - NOT the pre-transition cached slider.
  const ev = decodeMixerTransitionEvent(MIXER_TRANSITION_EVENT_TYPES.applied, {
    v: 1,
    from: "software",
    to: "hardware",
    carried_level: 30,
    effective_level: 25
  });
  assert.notEqual(ev, null);
  if (ev === null) return;
  const phase = reduceMixerTransition(IDLE_TRANSITION, { kind: "event", event: ev });
  assert.equal(phase.kind, "applied");
  if (phase.kind !== "applied") return;
  assert.equal(phase.effectiveLevel, 25, "slider must track effective, not carried");
});

test("decodeMixerTransitionEvent started carries from + to only", () => {
  const ev = decodeMixerTransitionEvent(MIXER_TRANSITION_EVENT_TYPES.started, {
    v: 1,
    from: "software",
    to: "hardware"
  });
  assert.notEqual(ev, null);
  if (ev === null || ev.kind !== "started") {
    assert.fail("expected started event");
    return;
  }
  assert.equal(ev.from, "software");
  assert.equal(ev.to, "hardware");
});

test("decodeMixerTransitionEvent rolled_back carries at_phase + reason", () => {
  const ev = decodeMixerTransitionEvent(
    MIXER_TRANSITION_EVENT_TYPES.rolledBack,
    {
      v: 1,
      from: "software",
      to: "hardware",
      at_phase: "set_new_authority",
      reason: "amixer write refused"
    }
  );
  assert.notEqual(ev, null);
  if (ev === null || ev.kind !== "rolled_back") {
    assert.fail("expected rolled_back event");
    return;
  }
  assert.equal(ev.atPhase, "set_new_authority");
  assert.equal(ev.reason, "amixer write refused");
});

test("decodeMixerTransitionEvent ignores non-transition event types", () => {
  assert.equal(
    decodeMixerTransitionEvent("audio.options.changed", { v: 1 }),
    null
  );
  assert.equal(decodeMixerTransitionEvent("peer_announced", {}), null);
});

test("decodeMixerTransitionEvent rejects a non-object payload", () => {
  assert.equal(
    decodeMixerTransitionEvent(MIXER_TRANSITION_EVENT_TYPES.started, null),
    null
  );
});

// --- T4/T5: lock serialisation - controls blocked while applying --

test("T4 isTransitionInFlight is true only during the applying phase", () => {
  const applying = reduceMixerTransition(IDLE_TRANSITION, {
    kind: "event",
    event: { kind: "started", from: "software", to: "hardware" }
  });
  assert.equal(isTransitionInFlight(applying), true);
  assert.equal(isTransitionInFlight(IDLE_TRANSITION), false);
});

test("T5 a second started supersedes a stale unacknowledged phase", () => {
  // Operator left a rolled_back banner up; a fresh transition starts.
  // The new started must take over the surface.
  const rolledBack: MixerTransitionPhase = {
    kind: "rolled_back",
    from: "software",
    to: "hardware",
    atPhase: "pre_mute",
    reason: "stale"
  };
  const next = reduceMixerTransition(rolledBack, {
    kind: "event",
    event: { kind: "started", from: "hardware", to: "none" }
  });
  assert.equal(next.kind, "applying");
  if (next.kind !== "applying") return;
  assert.equal(next.from, "hardware");
  assert.equal(next.to, "none");
});

test("reducer applied/rolled_back/failed are honoured from any phase", () => {
  // A UI that mounted mid-transition (missed the started frame) must
  // still react to the terminal event it does see.
  const fromIdle = reduceMixerTransition(IDLE_TRANSITION, {
    kind: "event",
    event: {
      kind: "applied",
      from: "software",
      to: "hardware",
      carriedLevel: 40,
      effectiveLevel: 40
    }
  });
  assert.equal(fromIdle.kind, "applied");

  const failed = reduceMixerTransition(IDLE_TRANSITION, {
    kind: "event",
    event: {
      kind: "failed",
      from: "software",
      to: "hardware",
      atPhase: "unmute",
      reason: "chain stuck muted"
    }
  });
  assert.equal(failed.kind, "failed");
});

test("reducer dismiss returns to idle from every terminal phase", () => {
  const phases: ReadonlyArray<MixerTransitionPhase> = [
    { kind: "applied", from: "software", to: "hardware", carriedLevel: 1, effectiveLevel: 1 },
    { kind: "rolled_back", from: "software", to: "hardware", atPhase: "p", reason: "r" },
    { kind: "failed", from: "software", to: "hardware", atPhase: "p", reason: "r" }
  ];
  for (const p of phases) {
    assert.equal(reduceMixerTransition(p, { kind: "dismiss" }).kind, "idle");
  }
});

// --- verify_install report decode -------------------------------

test("decodeVerifyInstallReport parses the wrapped envelope", () => {
  const r = decodeVerifyInstallReport({
    v: 1,
    report: {
      status: "partial",
      probes: [
        { name: "board_profile", ok: true, diagnostic: "resolved board profile" },
        { name: "catalogue", ok: true, diagnostic: "12 DAC entries" },
        { name: "sudoers_grant", ok: false, diagnostic: "run the bootstrap script" },
        { name: "modder_staging_dir", ok: true, diagnostic: "writable" }
      ]
    }
  });
  assert.notEqual(r, null);
  if (r === null) return;
  assert.equal(r.status, "partial");
  assert.equal(r.probes.length, 4);
  assert.equal(r.probes[2].name, "sudoers_grant");
  assert.equal(r.probes[2].ok, false);
});

test("decodeVerifyInstallReport accepts a bare report object", () => {
  const r = decodeVerifyInstallReport({
    status: "ok",
    probes: [{ name: "board_profile", ok: true, diagnostic: "ok" }]
  });
  assert.notEqual(r, null);
  if (r === null) return;
  assert.equal(r.status, "ok");
  assert.equal(r.probes.length, 1);
});

test("decodeVerifyInstallReport returns null when no probes array present", () => {
  assert.equal(decodeVerifyInstallReport({ v: 1, report: { status: "ok" } }), null);
  assert.equal(decodeVerifyInstallReport(undefined), null);
});

test("decodeVerifyInstallReport coerces an unknown status to failed", () => {
  const r = decodeVerifyInstallReport({ status: "weird", probes: [] });
  assert.notEqual(r, null);
  if (r === null) return;
  assert.equal(r.status, "failed");
});

// --- extractPluginEvent: tolerant happening-shape unwrapping -----

test("extractPluginEvent unwraps a { happening: { event_type, payload } } frame", () => {
  const f = extractPluginEvent({
    happening: {
      event_type: "audio.mixer_transition.started",
      payload: { v: 1, from: "software", to: "hardware" }
    }
  });
  assert.notEqual(f, null);
  if (f === null) return;
  assert.equal(f.eventType, "audio.mixer_transition.started");
});

test("extractPluginEvent unwraps an externally-tagged PluginEvent enum", () => {
  const f = extractPluginEvent({
    happening: {
      PluginEvent: {
        event_type: "audio.mixer_transition.applied",
        payload: { v: 1, from: "software", to: "hardware" }
      }
    }
  });
  assert.notEqual(f, null);
  if (f === null) return;
  assert.equal(f.eventType, "audio.mixer_transition.applied");
});

test("extractPluginEvent handles a bare { event_type, payload } object", () => {
  const f = extractPluginEvent({
    event_type: "audio.mixer_transition.failed",
    payload: { v: 1 }
  });
  assert.notEqual(f, null);
  if (f === null) return;
  assert.equal(f.eventType, "audio.mixer_transition.failed");
});

test("extractPluginEvent returns null when no event_type can be found", () => {
  assert.equal(extractPluginEvent({ happening: { variant: "peer_lost" } }), null);
  assert.equal(extractPluginEvent(undefined), null);
  assert.equal(extractPluginEvent("string"), null);
});

test("extractPluginEvent + decodeMixerTransitionEvent compose end-to-end", () => {
  // The path the hook runs: raw happening frame -> plugin event ->
  // typed transition event.
  const frame = extractPluginEvent({
    happening: {
      event_type: "audio.mixer_transition.applied",
      payload: {
        v: 1,
        from: "software",
        to: "hardware",
        carried_level: 30,
        effective_level: 25
      }
    }
  });
  assert.notEqual(frame, null);
  if (frame === null) return;
  const ev = decodeMixerTransitionEvent(frame.eventType, frame.payload);
  assert.notEqual(ev, null);
  if (ev === null || ev.kind !== "applied") {
    assert.fail("expected applied event");
    return;
  }
  assert.equal(ev.effectiveLevel, 25);
});

test("decodeVerifyInstallReport skips malformed probe entries", () => {
  const r = decodeVerifyInstallReport({
    status: "ok",
    probes: [
      { name: "board_profile", ok: true, diagnostic: "ok" },
      { ok: true, diagnostic: "no name - skipped" },
      "garbage"
    ]
  });
  assert.notEqual(r, null);
  if (r === null) return;
  assert.equal(r.probes.length, 1);
});

// =================================================================
// audio.delivery outputs (delivery.list_outputs).
//
// Fixtures are verbatim delivery.list_outputs payloads representing
// each supported architecture's typical card layout. The framework
// has already collapsed + classified the rows; the UI decodes them
// and filters Loopback / hidden rows.
// =================================================================

const ARM_OUTPUTS = {
  v: 1,
  outputs: [
    {
      card_idx: 0, device_idx: 0, card_name: "vc4-hdmi-0",
      alsa_id: "hw:0,0", label: "HDMI 0 Out", output_class: "hdmi",
      default_mixer_control: null, catalog_provenance: "curated",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 1, device_idx: 0, card_name: "vc4-hdmi-1",
      alsa_id: "hw:1,0", label: "HDMI 1 Out", output_class: "hdmi",
      default_mixer_control: null, catalog_provenance: "curated",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 2, device_idx: 0, card_name: "Loopback",
      alsa_id: "hw:2,0", label: "Loopback", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 2, device_idx: 1, card_name: "Loopback",
      alsa_id: "hw:2,1", label: "Loopback", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 3, device_idx: 0, card_name: "ExampleDAC",
      alsa_id: "hw:3,0", label: "ExampleDAC", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    }
  ]
};

const VM_OUTPUTS = {
  v: 1,
  outputs: [
    {
      card_idx: 0, device_idx: 0, card_name: "Loopback",
      alsa_id: "hw:0,0", label: "Loopback", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 0, device_idx: 1, card_name: "Loopback",
      alsa_id: "hw:0,1", label: "Loopback", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    },
    {
      card_idx: 1, device_idx: 0, card_name: "Intel 82801AA-ICH",
      alsa_id: "hw:1,0", label: "Intel 82801AA-ICH", output_class: "unknown",
      default_mixer_control: null, catalog_provenance: "unmapped",
      hidden: false, ignore_generic_mixer: false
    }
  ]
};

test("decodeAlsaOutputs decodes a representative ARM delivery.list_outputs payload", () => {
  const outs = decodeAlsaOutputs(ARM_OUTPUTS);
  assert.equal(outs.length, 5);
  assert.equal(outs[0].alsaId, "hw:0,0");
  assert.equal(outs[0].label, "HDMI 0 Out");
  assert.equal(outs[0].outputClass, "hdmi");
  assert.equal(outs[0].catalogProvenance, "curated");
  assert.equal(outs[4].cardName, "ExampleDAC");
  assert.equal(outs[4].outputClass, "unknown");
  assert.equal(outs[4].defaultMixerControl, null);
});

test("decodeAlsaOutputs accepts the bare subject array form", () => {
  const outs = decodeAlsaOutputs(ARM_OUTPUTS.outputs);
  assert.equal(outs.length, 5);
  assert.equal(outs[1].alsaId, "hw:1,0");
});

test("decodeAlsaOutputs coerces an unknown class + skips rows with no alsa_id", () => {
  const outs = decodeAlsaOutputs({
    v: 1,
    outputs: [
      { alsa_id: "hw:9,0", output_class: "wormhole" },
      { card_name: "no id - skipped" },
      "garbage"
    ]
  });
  assert.equal(outs.length, 1);
  assert.equal(outs[0].outputClass, "unknown");
  assert.equal(outs[0].label, "hw:9,0");
});

test("decodeAlsaOutputs returns [] for a malformed payload", () => {
  assert.deepEqual(decodeAlsaOutputs(undefined), []);
  assert.deepEqual(decodeAlsaOutputs({ v: 1 }), []);
  assert.deepEqual(decodeAlsaOutputs({ outputs: "not an array" }), []);
});

test("visibleOutputs drops hidden rows and the ALSA Loopback", () => {
  // ARM fixture: 5 outputs, two are Loopback -> 3 visible.
  const arm = visibleOutputs(decodeAlsaOutputs(ARM_OUTPUTS));
  assert.equal(arm.length, 3);
  assert.equal(
    arm.some((o) => o.cardName === "Loopback"),
    false
  );
  // VM: 3 outputs, two Loopback -> 1 visible (the onboard Intel).
  const vm = visibleOutputs(decodeAlsaOutputs(VM_OUTPUTS));
  assert.equal(vm.length, 1);
  assert.equal(vm[0].cardName, "Intel 82801AA-ICH");
  // The hidden flag is also honoured.
  const hiddenDropped = visibleOutputs(
    decodeAlsaOutputs({
      v: 1,
      outputs: [{ alsa_id: "hw:5,0", card_name: "USB DAC", hidden: true }]
    })
  );
  assert.equal(hiddenDropped.length, 0);
});

test("findSelectedOutput matches the persisted selection by alsa_id", () => {
  const outs = visibleOutputs(decodeAlsaOutputs(ARM_OUTPUTS));
  assert.equal(findSelectedOutput(outs, "hw:1,0")?.label, "HDMI 1 Out");
  assert.equal(findSelectedOutput(outs, "hw:9,9"), null);
  assert.equal(findSelectedOutput(outs, ""), null);
});

// =================================================================
// Audio chain - resampling / DoP / volume normalization.
// =================================================================

test("decodeResamplingPolicy decodes a full policy, camel-cased", () => {
  const p = decodeResamplingPolicy({
    enabled: true,
    target_bitdepth: "24",
    target_samplerate: "96000",
    quality: "high"
  });
  assert.equal(p.enabled, true);
  assert.equal(p.targetBitdepth, "24");
  assert.equal(p.targetSamplerate, "96000");
  assert.equal(p.quality, "high");
});

test("decodeResamplingPolicy yields the off/native default for junk input", () => {
  for (const junk of [null, undefined, "x", 7, []]) {
    const p = decodeResamplingPolicy(junk);
    assert.equal(p.enabled, false);
    assert.equal(p.targetBitdepth, "");
    assert.equal(p.targetSamplerate, "");
    assert.equal(p.quality, "");
  }
});

test("decodeAudioOptionsSettings decodes dop, volume_normalization, resampling", () => {
  const s = decodeAudioOptionsSettings({
    v: 1,
    dop: true,
    volume_normalization: true,
    resampling: {
      enabled: true,
      target_samplerate: "192000",
      quality: "very_high"
    }
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.dop, true);
  assert.equal(s.volumeNormalization, true);
  assert.equal(s.resampling.enabled, true);
  assert.equal(s.resampling.targetSamplerate, "192000");
  assert.equal(s.resampling.quality, "very_high");
});

test("decodeAudioOptionsSettings defaults dop/volume_normalization/resampling when absent", () => {
  const s = decodeAudioOptionsSettings({ v: 1 });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.dop, false);
  assert.equal(s.volumeNormalization, false);
  assert.equal(s.resampling.enabled, false);
});

// =================================================================
// hardware.audio - DAC selection + DSP controls.
//
// Fixtures are representative shapes of the hardware.audio request
// envelopes — the framework reference implementation publishes
// these on the `active_config` subject and via current_config.
// =================================================================

test("decodeActiveDacConfig decodes a representative current_config", () => {
  const a = decodeActiveDacConfig({
    v: 1,
    active: {
      alsacard_hint: "TestDAC",
      boot_config_path: "/boot/firmware/config.txt",
      catalogue_id: "synthetic-dac",
      display_name: "Synthetic DAC",
      mixer_hint: "Digital",
      overlay: "synthetic-overlay"
    }
  });
  assert.notEqual(a, null);
  if (a === null) return;
  assert.equal(a.catalogueId, "synthetic-dac");
  assert.equal(a.displayName, "Synthetic DAC");
  assert.equal(a.mixerHint, "Digital");
  assert.equal(a.alsacardHint, "TestDAC");
});

test("decodeActiveDacConfig null-ifies absent optional fields", () => {
  const a = decodeActiveDacConfig({
    v: 1,
    active: {
      overlay: "",
      catalogue_id: null,
      display_name: null,
      alsacard_hint: null,
      mixer_hint: null,
      boot_config_path: "/boot/firmware/config.txt"
    }
  });
  assert.notEqual(a, null);
  if (a === null) return;
  assert.equal(a.catalogueId, null);
  assert.equal(a.displayName, null);
  assert.equal(a.overlay, "");
});

test("decodeDacCatalogue decodes entries, skips id-less rows", () => {
  const c = decodeDacCatalogue({
    v: 1,
    profile: "Raspberry PI",
    catalogue: [
      {
        id: "synthetic-dac",
        display_name: "Synthetic DAC",
        overlay: "synthetic-overlay",
        needs_reboot_on_apply: true
      },
      { display_name: "no id - skipped" },
      "garbage"
    ]
  });
  assert.equal(c.length, 1);
  assert.equal(c[0].id, "synthetic-dac");
  assert.equal(c[0].displayName, "Synthetic DAC");
  assert.equal(c[0].needsRebootOnApply, true);
});

test("decodeDspCapabilities decodes the control set by domain kind", () => {
  const d = decodeDspCapabilities({
    v: 1,
    capabilities: {
      advanced_settings_enabled: true,
      alsa_card_hint: "DAC",
      dac_id: "synthetic-dac",
      controls: [
        {
          name: "I2S/SPDIF Select",
          human_label: "I2S/SPDIF Select",
          control_type: "enum",
          current_value: "I2S",
          value_domain: { kind: "enum", values: ["I2S", "SPDIF"] },
          bound: true
        },
        {
          name: "DoP",
          human_label: "DoP",
          control_type: "boolean",
          current_value: false,
          value_domain: { kind: "boolean" },
          bound: true
        },
        {
          name: "Digital",
          human_label: "Digital Playback Volume",
          control_type: "integer",
          current_value: 80,
          value_domain: { kind: "integer", min: 0, max: 100 },
          bound: true
        }
      ]
    }
  });
  assert.notEqual(d, null);
  if (d === null) return;
  assert.equal(d.dacId, "synthetic-dac");
  assert.equal(d.advancedSettingsEnabled, true);
  assert.equal(d.controls.length, 3);
  assert.equal(d.controls[0].kind, "enum");
  assert.deepEqual([...d.controls[0].enumValues], ["I2S", "SPDIF"]);
  assert.equal(d.controls[1].kind, "boolean");
  assert.equal(d.controls[2].kind, "integer");
  assert.equal(d.controls[2].rangeMin, 0);
  assert.equal(d.controls[2].rangeMax, 100);
  assert.equal(d.controls[2].currentValue, 80);
});

test("decodeDspCapabilities keeps an enum with an empty options list and surfaces description + recommended default", () => {
  // Representative empty-domain enum: a control the framework
  // resolved (bound, current_value read) but for which
  // value_domain.values came back empty. The decoder must keep
  // the current value and the catalogue attributes so the UI can
  // show what the control is set to rather than a blank box.
  const d = decodeDspCapabilities({
    v: 1,
    capabilities: {
      advanced_settings_enabled: true,
      dac_id: "synthetic-dac",
      controls: [
        {
          name: "FIR Filter Type",
          human_label: "FIR Filter (anti-alias)",
          control_type: "enum",
          current_value: "brick wall",
          recommended_default: "Slow Roll-Off",
          description: "Anti-alias filter shape near the Nyquist frequency.",
          value_domain: { kind: "enum", values: [] },
          bound: true
        }
      ]
    }
  });
  assert.notEqual(d, null);
  if (d === null) return;
  assert.equal(d.controls.length, 1);
  const fir = d.controls[0];
  assert.equal(fir.kind, "enum");
  assert.equal(fir.currentValue, "brick wall");
  assert.deepEqual([...fir.enumValues], []);
  assert.equal(fir.bound, true);
  assert.equal(
    fir.description,
    "Anti-alias filter shape near the Nyquist frequency."
  );
  assert.equal(fir.recommendedDefault, "Slow Roll-Off");
});

test("decodeDspCapabilities defaults description to empty and recommendedDefault to null when the control omits them", () => {
  const d = decodeDspCapabilities({
    v: 1,
    capabilities: {
      controls: [
        {
          name: "I2S/SPDIF Select",
          human_label: "I2S/SPDIF Select",
          control_type: "enum",
          current_value: "I2S",
          value_domain: { kind: "enum", values: ["I2S", "SPDIF"] },
          bound: true
        }
      ]
    }
  });
  assert.notEqual(d, null);
  if (d === null) return;
  assert.equal(d.controls[0].description, "");
  assert.equal(d.controls[0].recommendedDefault, null);
});

test("decodeDacRebootRequired reads the select_dac outcome", () => {
  assert.equal(
    decodeDacRebootRequired({
      v: 1,
      status: "ok",
      outcome: { overlay: "i-sabre-q2m", reboot_required: true }
    }),
    true
  );
  assert.equal(
    decodeDacRebootRequired({ v: 1, status: "ok", outcome: {} }),
    false
  );
  assert.equal(decodeDacRebootRequired(null), false);
});

test("decodePluginNames extracts ids from the list_plugins envelope and a bare array", () => {
  assert.deepEqual(
    decodePluginNames({
      plugins: [
        { name: "org.evoframework.system.power" },
        { name: "org.evoframework.playback.options" }
      ]
    }),
    ["org.evoframework.system.power", "org.evoframework.playback.options"]
  );
  assert.deepEqual(
    decodePluginNames(["org.evoframework.system.power"]),
    ["org.evoframework.system.power"]
  );
  assert.deepEqual(decodePluginNames({ id: "x" }), []);
  assert.deepEqual(decodePluginNames(null), []);
});

test("classifyPowerVerbOutcome treats no-error and a connection drop as accepted", () => {
  // The host tears the framework down before the wire response is
  // guaranteed to arrive - a dropped connection is the success path.
  assert.equal(classifyPowerVerbOutcome(undefined).kind, "accepted");
  assert.equal(
    classifyPowerVerbOutcome({ code: "connection_closed", message: "x" }).kind,
    "accepted"
  );
  assert.equal(
    classifyPowerVerbOutcome({ code: "aborted", message: "x" }).kind,
    "accepted"
  );
});

test("classifyPowerVerbOutcome routes the two PermissionDenied subclasses", () => {
  assert.equal(
    classifyPowerVerbOutcome({
      code: "PermissionDenied",
      subclass: "step_up_required",
      message: "needs step-up"
    }).kind,
    "step_up_required"
  );
  assert.equal(
    classifyPowerVerbOutcome({
      code: "PermissionDenied",
      subclass: "verb_capability_scope_not_granted",
      message: "no scope"
    }).kind,
    "not_authorised"
  );
  // A PermissionDenied with no recognised subclass still routes to
  // not_authorised rather than a generic error.
  assert.equal(
    classifyPowerVerbOutcome({ code: "PermissionDenied", message: "denied" })
      .kind,
    "not_authorised"
  );
  assert.equal(
    classifyPowerVerbOutcome({ code: "internal", message: "boom" }).kind,
    "error"
  );
});

test("sha256Hex matches the FIPS 180-4 test vectors", () => {
  const enc = new TextEncoder();
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    sha256Hex(enc.encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  // 56 bytes - the message + 0x80 + length overflow one 64-byte
  // block, exercising the multi-block padding path.
  assert.equal(
    sha256Hex(
      enc.encode(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
      )
    ),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  );
});

test("decodeModderSurface decodes overlays, surface + allowlist state", () => {
  const s = decodeModderSurface({
    v: 1,
    surface_state: "enabled",
    allowlist_status: "loaded",
    overlays: [
      {
        row: {
          id: "my-dac",
          display_name: "My Custom DAC",
          board_profile: "Raspberry PI",
          interface: "i2s",
          overlay: "my-custom-dac",
          dtbo_sha256_hex: "abc123",
          alsa_card_hint: "MyDAC",
          in_card_mixer: "Digital",
          dsp_options: ["filter"],
          override_base: false
        },
        state: { kind: "active" }
      },
      {
        row: {
          id: "bad-dac",
          display_name: "Bad",
          interface: "hdmi",
          overlay: "x",
          dtbo_sha256_hex: "def"
        },
        state: { kind: "refused", reason: "hash not in allowlist" }
      }
    ]
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.surfaceEnabled, true);
  assert.equal(s.allowlistLoaded, true);
  assert.equal(s.overlays.length, 2);
  assert.equal(s.overlays[0].id, "my-dac");
  assert.equal(s.overlays[0].interface, "i2s");
  assert.deepEqual([...s.overlays[0].dspOptions], ["filter"]);
  assert.equal(s.overlays[0].state.kind, "active");
  const refused = s.overlays[1].state;
  assert.equal(refused.kind, "refused");
  if (refused.kind === "refused") {
    assert.equal(refused.reason, "hash not in allowlist");
  }
});

test("decodeModderSurface flags a disabled surface and absent allowlist", () => {
  const s = decodeModderSurface({
    v: 1,
    surface_state: "disabled",
    allowlist_status: "absent",
    overlays: []
  });
  assert.notEqual(s, null);
  if (s === null) return;
  assert.equal(s.surfaceEnabled, false);
  assert.equal(s.allowlistLoaded, false);
  assert.equal(s.overlays.length, 0);
});

test("decodeCatalogueProfile reads the board profile", () => {
  assert.equal(
    decodeCatalogueProfile({ v: 1, profile: "Raspberry PI", catalogue: [] }),
    "Raspberry PI"
  );
  assert.equal(decodeCatalogueProfile({}), "");
  assert.equal(decodeCatalogueProfile(null), "");
});
