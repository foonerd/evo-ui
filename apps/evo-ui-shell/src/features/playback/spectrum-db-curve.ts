// Visualizer dB-axis curve - pure math, separated from
// Visualizer.tsx so the contract tests (which run under
// node --experimental-strip-types) can import it without
// pulling in JSX.
//
// Wire magnitudes arrive linear in [0, 1]; the renderer maps
// them through 20*log10 with an operator sensitivity offset,
// clamps into a [-60, 0] dBFS window, normalises to [0, 1] for
// the meter, and writes into the supplied target buffer in
// place.
//
// Rationale: real music spreads spectral energy across all 256
// mel bins, so per-bin peak magnitudes naturally land around
// 0.05-0.25 even at full output (-13 dBFS at the loudest bin
// measured live on the rig). On a linear Y axis that renders as
// 5-25% of meter height (anaemic). On this dB window the same
// -13 dBFS renders at 78% of meter height.

/** dB floor of the visualisation window. -60 dBFS is the
 *  conventional floor for music meters. -80 dBFS would be a
 *  noise-floor diagnostic window; widen later if operators
 *  want it surfaced. */
export const DB_FLOOR = -60;

/** dB ceiling of the visualisation window. 0 dBFS matches the
 *  framework's `magnitudes = 1.0` reference (a full-scale sine
 *  at the bin's centre frequency reads 1.0). */
export const DB_CEIL = 0;

/** Span of the window in dB. */
export const DB_SPAN = DB_CEIL - DB_FLOOR;

/** Linear-amplitude floor below which we treat the bin as
 *  silence and skip the log10. log10(0) is -Infinity,
 *  log10(tiny) is wildly negative; both blow up the clamp.
 *  1e-6 corresponds to ~-120 dBFS - well below the audible
 *  noise range so the clamp is invisible. */
export const DB_LINEAR_FLOOR = 1e-6;

/**
 * Map wire-side linear magnitudes through the dB curve with an
 * operator sensitivity offset. For each bin:
 *
 *   db_raw      = 20 * log10(max(mag, DB_LINEAR_FLOOR))
 *   db_adjusted = db_raw + sensitivityDb
 *   displayed   = clamp((db_adjusted - DB_FLOOR) / DB_SPAN, 0, 1)
 *
 * Writes into `out` in place. `mags` and `out` must be the same
 * length and use the same interleaved layout as the wire
 * buffer ([L0, R0, L1, R1, ...]).
 *
 * Pure compute. Contract tests in spectrum-db-curve.test.ts.
 */
export function dbTransform(
  mags: Float32Array,
  out: Float32Array,
  sensitivityDb: number
): void {
  const n = mags.length;
  for (let i = 0; i < n; i++) {
    const m = mags[i];
    if (!(m > DB_LINEAR_FLOOR)) {
      out[i] = 0;
      continue;
    }
    const db = 20 * Math.log10(m) + sensitivityDb;
    const norm = (db - DB_FLOOR) / DB_SPAN;
    out[i] = norm <= 0 ? 0 : norm >= 1 ? 1 : norm;
  }
}
