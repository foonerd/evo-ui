// Contract tests for the audio.playback stream_format decoders.
//
// Each test synthesises the wire frame the framework emits - the
// subject_state_changed happening carrying the stream_format
// subject's new_state - and asserts the decoded shape, so the DAC
// stage readout is verifiable without live playback.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeAudioFormat,
  decodeStreamFormat,
  decodeStreamFormatHappening,
  formatAudioFormat,
  audioFormatsEqual
} from "../../src/features/audio/stream-format-decoders.ts";

// --- decodeAudioFormat -------------------------------------------

test("decodeAudioFormat decodes a pcm format", () => {
  const f = decodeAudioFormat({
    kind: "pcm",
    codec: "pcm_s24_le",
    rate_hz: 192000,
    channels: 2
  });
  assert.deepEqual(f, {
    kind: "pcm",
    codec: "pcm_s24_le",
    rateHz: 192000,
    channels: 2
  });
});

test("decodeAudioFormat decodes a dsd format", () => {
  const f = decodeAudioFormat({
    kind: "dsd",
    rate: "DSD256",
    transport: "native_usb",
    channels: 2
  });
  assert.deepEqual(f, {
    kind: "dsd",
    rate: "DSD256",
    transport: "native_usb",
    channels: 2
  });
});

test("decodeAudioFormat decodes an encoded_passthrough format", () => {
  const f = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "ac3",
    rate_hz: 48000,
    channels: 6
  });
  assert.deepEqual(f, {
    kind: "encoded_passthrough",
    codec: "ac3",
    rateHz: 48000,
    channels: 6,
    bitrate: null
  });
});

test("decodeAudioFormat decodes encoded_passthrough with CBR bitrate", () => {
  const f = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "mp3",
    rate_hz: 44100,
    channels: 2,
    bitrate_kbps: { kind: "cbr", kbps: 192 }
  });
  assert.deepEqual(f, {
    kind: "encoded_passthrough",
    codec: "mp3",
    rateHz: 44100,
    channels: 2,
    bitrate: { kind: "cbr", kbps: 192 }
  });
});

test("decodeAudioFormat decodes encoded_passthrough with VBR bitrate", () => {
  const f = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "mp3",
    rate_hz: 44100,
    channels: 2,
    bitrate_kbps: { kind: "vbr", avg_kbps: 245 }
  });
  assert.equal(f?.kind, "encoded_passthrough");
  if (f?.kind === "encoded_passthrough") {
    assert.deepEqual(f.bitrate, { kind: "vbr", avgKbps: 245 });
  }
});

test("decodeAudioFormat decodes encoded_passthrough with Unknown bitrate (Opus head)", () => {
  const f = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "opus",
    rate_hz: 48000,
    channels: 2,
    bitrate_kbps: { kind: "unknown" }
  });
  assert.equal(f?.kind, "encoded_passthrough");
  if (f?.kind === "encoded_passthrough") {
    assert.deepEqual(f.bitrate, { kind: "unknown" });
  }
});

test("decodeAudioFormat rejects malformed bitrate_kbps shapes (no fabrication)", () => {
  // Missing kbps on cbr -> bitrate becomes null, format still decodes.
  const a = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "mp3",
    rate_hz: 44100,
    channels: 2,
    bitrate_kbps: { kind: "cbr" }
  });
  assert.equal(a?.kind, "encoded_passthrough");
  if (a?.kind === "encoded_passthrough") assert.equal(a.bitrate, null);
  // Unrecognised kind token -> bitrate becomes null.
  const b = decodeAudioFormat({
    kind: "encoded_passthrough",
    codec: "mp3",
    rate_hz: 44100,
    channels: 2,
    bitrate_kbps: { kind: "garbled" }
  });
  assert.equal(b?.kind, "encoded_passthrough");
  if (b?.kind === "encoded_passthrough") assert.equal(b.bitrate, null);
});

test("decodeAudioFormat returns null for unknown kind or missing fields", () => {
  assert.equal(decodeAudioFormat({ kind: "analogue" }), null);
  assert.equal(decodeAudioFormat({ kind: "pcm", codec: "pcm_s16_le" }), null);
  assert.equal(decodeAudioFormat(null), null);
});

// --- decodeStreamFormat ------------------------------------------

test("decodeStreamFormat decodes effective + source + sourceCodec", () => {
  const sf = decodeStreamFormat({
    v: 1,
    effective: { kind: "pcm", codec: "pcm_s32_le", rate_hz: 96000, channels: 2 },
    source: { kind: "dsd", rate: "DSD64", transport: "dop", channels: 2 },
    source_codec: "flac"
  });
  assert.notEqual(sf, null);
  assert.equal(sf?.effective?.kind, "pcm");
  assert.equal(sf?.source?.kind, "dsd");
  assert.equal(sf?.sourceCodec, "flac");
});

test("decodeStreamFormat treats a null source as null, keeps effective", () => {
  const sf = decodeStreamFormat({
    v: 1,
    effective: { kind: "pcm", codec: "pcm_s16_le", rate_hz: 44100, channels: 2 },
    source: null,
    source_codec: "wav"
  });
  assert.equal(sf?.source, null);
  assert.equal(sf?.effective?.kind, "pcm");
  assert.equal(sf?.sourceCodec, "wav");
});

test("decodeStreamFormat accepts the seeded-empty envelope (all three live fields null)", () => {
  // The announcement-time envelope arrives before the first
  // route-change publish. All three live fields are null but
  // the envelope itself is well-formed and decodes to a
  // StreamFormat with three nulls. UI consumers branch on the
  // individual fields.
  const sf = decodeStreamFormat({
    v: 1,
    effective: null,
    source: null,
    source_codec: null
  });
  assert.notEqual(sf, null);
  assert.equal(sf?.effective, null);
  assert.equal(sf?.source, null);
  assert.equal(sf?.sourceCodec, null);
});

test("decodeStreamFormat returns null only for non-object input", () => {
  assert.equal(decodeStreamFormat(null), null);
  assert.equal(decodeStreamFormat(undefined), null);
  assert.equal(decodeStreamFormat("not an object"), null);
  assert.equal(decodeStreamFormat([]), null);
});

test("decodeStreamFormat treats absent source_codec as null", () => {
  const sf = decodeStreamFormat({
    v: 1,
    effective: { kind: "pcm", codec: "pcm_s16_le", rate_hz: 44100, channels: 2 },
    source: null
    // source_codec omitted
  });
  assert.equal(sf?.sourceCodec, null);
});

test("decodeStreamFormat covers all framework codec tokens", () => {
  // The framework's source_codec field carries one of these
  // canonical lowercase tokens:
  // flac / wav / aiff / ape / alac / wavpack / tta / shorten /
  // dsf / dff / mp3 / vorbis / opus / aac / wma / musepack / mod / speex
  const tokens = ["flac", "mp3", "dsf", "dff", "wav", "aiff", "ape",
                  "alac", "wavpack", "tta", "shorten", "vorbis",
                  "opus", "aac", "wma", "musepack", "mod", "speex"];
  for (const token of tokens) {
    const sf = decodeStreamFormat({ v: 1, effective: null, source: null,
                                    source_codec: token });
    assert.equal(sf?.sourceCodec, token, `token ${token} did not round-trip`);
  }
});

// --- decodeStreamFormatHappening ---------------------------------

function streamFormatHappening(newState: unknown): Record<string, unknown> {
  return {
    type: "subject_state_changed",
    subject_type: "audio_playback_stream_format",
    canonical_id: "999c7264-528b-4cb7-8f75-40229cfbe012",
    prev_state: null,
    new_state: newState,
    at_ms: 1716400000000
  };
}

test("decodeStreamFormatHappening decodes a stream_format subject_state_changed", () => {
  const sf = decodeStreamFormatHappening(
    streamFormatHappening({
      v: 1,
      effective: {
        kind: "pcm",
        codec: "pcm_s24_le",
        rate_hz: 192000,
        channels: 2
      },
      source: null
    })
  );
  assert.notEqual(sf, null);
  assert.equal(sf?.effective?.kind, "pcm");
});

test("decodeStreamFormatHappening unwraps a { happening: ... } envelope", () => {
  const sf = decodeStreamFormatHappening({
    happening: streamFormatHappening({
      v: 1,
      effective: { kind: "pcm", codec: "pcm_f32", rate_hz: 48000, channels: 2 },
      source: null
    })
  });
  assert.equal(sf?.effective?.kind, "pcm");
});

test("decodeStreamFormatHappening ignores other subjects and other happenings", () => {
  // Right happening type, wrong subject.
  const other = streamFormatHappening({ v: 1, effective: {} });
  other["subject_type"] = "hardware_audio_dac_config";
  assert.equal(decodeStreamFormatHappening(other), null);
  // Wrong happening type.
  assert.equal(
    decodeStreamFormatHappening({ type: "plugin_reload_dispatched" }),
    null
  );
});

// --- formatAudioFormat + audioFormatsEqual -----------------------

test("formatAudioFormat renders human-readable labels", () => {
  assert.equal(
    formatAudioFormat({
      kind: "pcm",
      codec: "pcm_s24_le",
      rateHz: 192000,
      channels: 2
    }),
    "192 kHz / 24-bit / stereo"
  );
  assert.equal(
    formatAudioFormat({
      kind: "pcm",
      codec: "pcm_s16_le",
      rateHz: 44100,
      channels: 2
    }),
    "44.1 kHz / 16-bit / stereo"
  );
  assert.equal(
    formatAudioFormat({
      kind: "dsd",
      rate: "DSD64",
      transport: "dop",
      channels: 2
    }),
    "DSD64 (DoP) / stereo"
  );
  assert.equal(
    formatAudioFormat({
      kind: "encoded_passthrough",
      codec: "ac3",
      rateHz: 48000,
      channels: 6,
      bitrate: null
    }),
    "AC3 48 kHz / 6ch"
  );
  assert.equal(
    formatAudioFormat({
      kind: "encoded_passthrough",
      codec: "mp3",
      rateHz: 44100,
      channels: 2,
      bitrate: { kind: "cbr", kbps: 192 }
    }),
    "MP3 44.1 kHz / 192 kbps / stereo"
  );
  assert.equal(
    formatAudioFormat({
      kind: "encoded_passthrough",
      codec: "mp3",
      rateHz: 44100,
      channels: 2,
      bitrate: { kind: "vbr", avgKbps: 245 }
    }),
    "MP3 44.1 kHz / 245 kbps VBR / stereo"
  );
  assert.equal(
    formatAudioFormat({
      kind: "encoded_passthrough",
      codec: "opus",
      rateHz: 48000,
      channels: 2,
      bitrate: { kind: "unknown" }
    }),
    "OPUS 48 kHz / VBR / stereo"
  );
});

test("audioFormatsEqual compares by rendered label", () => {
  const a = { kind: "pcm", codec: "pcm_s16_le", rateHz: 44100, channels: 2 } as const;
  const b = { kind: "pcm", codec: "pcm_s16_le", rateHz: 44100, channels: 2 } as const;
  const c = { kind: "pcm", codec: "pcm_s24_le", rateHz: 44100, channels: 2 } as const;
  assert.equal(audioFormatsEqual(a, b), true);
  assert.equal(audioFormatsEqual(a, c), false);
});
