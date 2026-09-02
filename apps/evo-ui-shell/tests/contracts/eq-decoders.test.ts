// Contract tests for the parametric-EQ pure logic.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEqBands,
  clampEqBand,
  defaultEqBand,
  flatEqBands,
  spreadEqBands,
  eqBandToPayload,
  eqBandToWire,
  decodeEqPresetList,
  decodeSelectModeOutcome,
  eqResponseDb,
  serialiseEqPresetLibrary,
  parseEqPresetLibrary,
  decodeEqPreset,
  EQ_BAND_COUNT
} from "../../src/features/audio/eq-decoders.ts";

// --- decodeEqBands -----------------------------------------------

test("decodeEqBands always yields exactly 10 bands", () => {
  assert.equal(decodeEqBands([]).length, EQ_BAND_COUNT);
  assert.equal(decodeEqBands(undefined).length, EQ_BAND_COUNT);
  assert.equal(
    decodeEqBands([{ freq_hz: 100, gain_db: 2, q: 1 }]).length,
    EQ_BAND_COUNT
  );
});

test("decodeEqBands decodes wire fields and clamps to domain", () => {
  const out = decodeEqBands([
    { freq_hz: 440, gain_db: 3.5, q: 2 },
    { freq_hz: 999999, gain_db: 99, q: 999 },
    { freq_hz: 1, gain_db: -99, q: 0 }
  ]);
  assert.deepEqual(out[0], { freqHz: 440, gainDb: 3.5, q: 2 });
  assert.deepEqual(out[1], { freqHz: 20000, gainDb: 15, q: 30 });
  assert.deepEqual(out[2], { freqHz: 20, gainDb: -15, q: 0.1 });
  // Padded bands are the flat default.
  assert.deepEqual(out[9], defaultEqBand());
});

test("clampEqBand rounds frequency and bounds every field", () => {
  assert.deepEqual(clampEqBand({ freqHz: 440.7, gainDb: 20, q: -1 }), {
    freqHz: 441,
    gainDb: 15,
    q: 0.1
  });
});

test("flatEqBands and spreadEqBands both yield 10 flat bands", () => {
  const flat = flatEqBands();
  const spread = spreadEqBands();
  assert.equal(flat.length, 10);
  assert.equal(spread.length, 10);
  assert.ok(flat.every((b) => b.gainDb === 0));
  assert.ok(spread.every((b) => b.gainDb === 0));
  // spreadEqBands places bands at distinct ascending frequencies.
  assert.ok(spread[0].freqHz < spread[9].freqHz);
  // flatEqBands stacks every band on 1 kHz.
  assert.ok(flat.every((b) => b.freqHz === 1000));
});

test("eqBandToPayload builds the set_eq_band wire shape", () => {
  assert.deepEqual(eqBandToPayload(3, { freqHz: 250, gainDb: -2, q: 1.5 }), {
    v: 1,
    index: 3,
    freq_hz: 250,
    gain_db: -2,
    q: 1.5
  });
});

// --- decodeSelectModeOutcome -------------------------------------

test("decodeSelectModeOutcome reads the status verdict", () => {
  const ok = decodeSelectModeOutcome({ v: 1, status: "ok", active_mode: "eq_only" });
  assert.deepEqual(ok, { ok: true, activeMode: "eq_only" });
  const bad = decodeSelectModeOutcome({
    v: 1,
    status: "bad_request",
    error: "eq_only refused: PCM codec PcmS24Le not supported"
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /PcmS24Le/);
});

test("decodeSelectModeOutcome fails closed on an unreadable value", () => {
  const r = decodeSelectModeOutcome(null);
  assert.equal(r.ok, false);
});

// --- eqResponseDb ------------------------------------------------

test("eqResponseDb is flat for zero-gain bands", () => {
  assert.equal(eqResponseDb(flatEqBands(), 1000), 0);
  assert.equal(eqResponseDb(spreadEqBands(), 440), 0);
});

test("eqResponseDb peaks near a boosted band's centre frequency", () => {
  const bands = spreadEqBands();
  bands[5] = { freqHz: 1000, gainDb: 6, q: 1 };
  const atCentre = eqResponseDb(bands, 1000);
  const farAway = eqResponseDb(bands, 60);
  assert.ok(atCentre > 5, `expected boost at centre, got ${atCentre}`);
  assert.ok(Math.abs(farAway) < 1, `expected near-flat far away, got ${farAway}`);
});

// --- presets -----------------------------------------------------

test("preset library round-trips through serialise + parse", () => {
  const lib = [
    { name: "V-shape", bands: spreadEqBands() },
    { name: "Vocal lift", bands: flatEqBands() }
  ];
  const parsed = parseEqPresetLibrary(serialiseEqPresetLibrary(lib));
  assert.notEqual(parsed, null);
  assert.equal(parsed?.length, 2);
  assert.equal(parsed?.[0].name, "V-shape");
  assert.equal(parsed?.[0].bands.length, 10);
});

test("parseEqPresetLibrary tolerates a bare array and rejects junk", () => {
  const bare = parseEqPresetLibrary(
    JSON.stringify([{ name: "x", bands: flatEqBands() }])
  );
  assert.equal(bare?.length, 1);
  assert.equal(parseEqPresetLibrary("not json"), null);
  assert.equal(parseEqPresetLibrary(JSON.stringify({ schema: "other" })), null);
});

test("decodeEqPreset rejects a preset with no name", () => {
  assert.equal(decodeEqPreset({ bands: flatEqBands() }), null);
  assert.equal(decodeEqPreset({ name: "  ", bands: flatEqBands() }), null);
  assert.notEqual(decodeEqPreset({ name: "ok", bands: flatEqBands() }), null);
});

test("eqBandToWire emits the bare freq_hz / gain_db / q shape", () => {
  assert.deepEqual(eqBandToWire({ freqHz: 250.6, gainDb: 3, q: 99 }), {
    freq_hz: 251,
    gain_db: 3,
    q: 30
  });
});

test("decodeEqPresetList decodes the list_eq_presets response", () => {
  const out = decodeEqPresetList({
    v: 1,
    presets: [
      { name: "Warm", bands: flatEqBands() },
      { bands: flatEqBands() },
      { name: "Bright", bands: flatEqBands() }
    ]
  });
  // The nameless middle entry is skipped.
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((p) => p.name),
    ["Warm", "Bright"]
  );
  assert.deepEqual(decodeEqPresetList(null), []);
});
