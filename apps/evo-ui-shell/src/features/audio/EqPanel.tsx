// EqPanel - the parametric-EQ surface in the Processing stage.
//
// Owns the live band state for smooth dragging and the selected
// band; the active EQ is framework state, edited through setBand /
// setEngaged / selectMode. Turning the EQ on selects the eq_only
// composition mode, which the framework refuses on an unsupported
// format - the refusal reason is shown rather than a dead toggle.
//
// One gesture, one write. A drag moves the curve locally and writes
// the band once when the pointer is released; the Q slider writes on
// release. Every options write is a settings publish the device
// answers with a pipeline rewrite, so a burst of writes was a burst
// of rewrites - and a restart storm on the player. Reset to flat is
// the atomic preset path (save the flat preset, recall it), never ten
// setters.
//
// The EQ-on flag is the hook's session flag until the device exposes
// a composition-mode read; it is not a substitute for that read.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { EqCurveEditor } from "./EqCurveEditor";
import { EqPresetRow } from "./EqPresetRow";
import {
  spreadEqBands,
  type EqBand,
  type EqPreset,
  type SelectModeOutcome
} from "./eq-decoders";
import type { CompositionMode } from "./audio-options-decoders";
import type { AudioSetterResult } from "./useAudioOptions";

interface EqPanelProps {
  /** The 10 EQ bands from audio.options.settings. */
  bands: ReadonlyArray<EqBand>;
  /** eq_engaged A/B flag. */
  engaged: boolean;
  /** The device's composition mode from options.settings; null while
   *  the player has not reported it. */
  eqMode: CompositionMode | null;
  /** True while a transition / gesture locks the controls. */
  locked: boolean;
  setBand: (index: number, band: EqBand) => Promise<AudioSetterResult>;
  setEngaged: (value: boolean) => Promise<AudioSetterResult>;
  selectMode: (on: boolean) => Promise<SelectModeOutcome>;
  listPresets: () => Promise<ReadonlyArray<EqPreset>>;
  savePreset: (
    name: string,
    bands: ReadonlyArray<EqBand>
  ) => Promise<AudioSetterResult>;
  recallPreset: (name: string) => Promise<AudioSetterResult>;
  deletePreset: (name: string) => Promise<AudioSetterResult>;
}

/** The preset Reset to flat saves and recalls, so the ten bands land in
 *  one atomic write on the device instead of ten. */
const FLAT_PRESET_NAME = "Flat";

export function EqPanel({
  bands,
  engaged,
  eqMode,
  locked,
  setBand,
  setEngaged,
  selectMode,
  listPresets,
  savePreset,
  recallPreset,
  deletePreset
}: EqPanelProps) {
  // On means the device says eq_only. An unreported mode is its own
  // state: the toggle waits rather than claiming off.
  const modeActive = eqMode === "eq_only";
  const modeKnown = eqMode !== null;
  const [localBands, setLocalBands] = useState<EqBand[]>(() =>
    bands.map((b) => ({ ...b }))
  );
  const [selected, setSelected] = useState(0);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [eqError, setEqError] = useState<string | null>(null);
  // Bands a gesture has moved and not yet written. While any is
  // outstanding the local curve is the truth; the device's bands are
  // adopted again once the gesture has been written.
  const dirtyRef = useRef<Set<number>>(new Set());
  const localRef = useRef<EqBand[]>(localBands);
  localRef.current = localBands;

  // Adopt external band changes (settings refresh, recall) unless a
  // gesture is in flight - the drag owns the live band state until it
  // ends and its one write lands.
  useEffect(() => {
    if (dirtyRef.current.size === 0) {
      setLocalBands(bands.map((b) => ({ ...b })));
    }
  }, [bands]);

  // Live value during a gesture: the curve follows, nothing is written.
  const onBandChange = useCallback((index: number, band: EqBand): void => {
    dirtyRef.current.add(index);
    setLocalBands((prev) => {
      const next = prev.slice();
      next[index] = band;
      return next;
    });
  }, []);

  // The gesture ended: one set_eq_band for the band it moved. A click
  // that moved nothing writes nothing.
  const onBandCommit = useCallback(
    (index: number): void => {
      const dirty = dirtyRef.current;
      if (!dirty.has(index)) return;
      const band = localRef.current[index];
      if (band === undefined) return;
      dirty.delete(index);
      void setBand(index, band).then((r) => {
        if (!r.ok) setEqError(r.message);
      });
    },
    [setBand]
  );

  const onToggleMode = useCallback(async (): Promise<void> => {
    setModeBusy(true);
    setModeError(null);
    const outcome = await selectMode(!modeActive);
    setModeBusy(false);
    if (!outcome.ok) setModeError(outcome.reason);
  }, [modeActive, selectMode]);

  const onToggleEngaged = useCallback(async (): Promise<void> => {
    setEqError(null);
    const r = await setEngaged(!engaged);
    if (!r.ok) setEqError(r.message);
  }, [engaged, setEngaged]);

  // Reset to flat through the atomic preset path: save the flat curve
  // under one name, recall it. Recall applies the ten bands in one
  // write on the device and one changed happening back. A refused save
  // (library cap, bad name) is shown; it never falls back to ten setters.
  const onReset = useCallback(async (): Promise<void> => {
    setEqError(null);
    const flat = spreadEqBands();
    const saved = await savePreset(FLAT_PRESET_NAME, flat);
    if (!saved.ok) {
      setEqError(saved.message);
      return;
    }
    const recalled = await recallPreset(FLAT_PRESET_NAME);
    if (!recalled.ok) {
      setEqError(recalled.message);
      return;
    }
    setLocalBands(flat);
  }, [savePreset, recallPreset]);

  return (
    <div className="audio-eq">
      <label className="settings-label" htmlFor="audio-eq-enable">
        <span>Parametric EQ</span>
        <input
          id="audio-eq-enable"
          type="checkbox"
          className="audio-toggle"
          checked={modeActive}
          disabled={locked || modeBusy || !modeKnown}
          onChange={() => void onToggleMode()}
        />
      </label>
      {!modeKnown ? (
        <p className="audio-stage-note">
          The player has not reported the EQ mode yet.
        </p>
      ) : null}
      {modeError !== null ? (
        <p className="audio-options-hint-warning" role="alert">
          {modeError}
        </p>
      ) : null}

      {modeActive ? (
        <>
          <label className="settings-label" htmlFor="audio-eq-engaged">
            <span>EQ engaged (A / B)</span>
            <input
              id="audio-eq-engaged"
              type="checkbox"
              className="audio-toggle"
              checked={engaged}
              disabled={locked}
              onChange={() => void onToggleEngaged()}
            />
          </label>
          <EqCurveEditor
            bands={localBands}
            selectedIndex={selected}
            engaged={engaged}
            disabled={locked}
            onSelect={setSelected}
            onBandChange={onBandChange}
            onBandCommit={onBandCommit}
          />
          <EqPresetRow
            currentBands={localBands}
            disabled={locked}
            onList={listPresets}
            onSave={savePreset}
            onRecall={recallPreset}
            onDelete={deletePreset}
          />
          <div className="audio-eq-actions">
            <button
              type="button"
              className="audio-eq-reset"
              disabled={locked}
              onClick={() => void onReset()}
            >
              Reset to flat
            </button>
          </div>
          {eqError !== null ? (
            <p className="audio-options-hint-warning" role="alert">
              {eqError}
            </p>
          ) : null}
          <p className="audio-stage-note">
            Drag a point to set its frequency and gain; select a
            point and use the Q slider for bandwidth. EQ engaged is
            the A / B - off passes the stream through unchanged
            while keeping the curve configured.
          </p>
        </>
      ) : (
        <p className="audio-stage-note">
          Turn the parametric EQ on to shape the response with 10
          peaking bands. eq_only mode is refused on formats the EQ
          DSP does not support - 24 or 32-bit, DSD, or more than two
          channels.
        </p>
      )}
    </div>
  );
}
