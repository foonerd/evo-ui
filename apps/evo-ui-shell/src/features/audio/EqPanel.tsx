// EqPanel - the parametric-EQ surface in the Processing stage.
//
// Owns the live band state for smooth dragging and the selected
// band; the active EQ is framework state, edited through setBand /
// setEngaged / selectMode. Turning the EQ on selects the eq_only
// composition mode, which the framework refuses on an unsupported
// format - the refusal reason is shown rather than a dead toggle.
//
// The named-preset row (save / recall / delete + export / import)
// is a separate follow-up; the framework preset verbs have landed
// but are not wired here yet.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { EqCurveEditor } from "./EqCurveEditor";
import { EqPresetRow } from "./EqPresetRow";
import {
  spreadEqBands,
  type EqBand,
  type EqPreset,
  type SelectModeOutcome
} from "./eq-decoders";
import type { AudioSetterResult } from "./useAudioOptions";

interface EqPanelProps {
  /** The 10 EQ bands from audio.options.settings. */
  bands: ReadonlyArray<EqBand>;
  /** eq_engaged A/B flag. */
  engaged: boolean;
  /** True when this session has selected eq_only mode. */
  modeActive: boolean;
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

/** Debounce on the per-band set_eq_band dispatch while dragging. */
const BAND_DISPATCH_DEBOUNCE_MS = 140;

export function EqPanel({
  bands,
  engaged,
  modeActive,
  locked,
  setBand,
  setEngaged,
  selectMode,
  listPresets,
  savePreset,
  recallPreset,
  deletePreset
}: EqPanelProps) {
  const [localBands, setLocalBands] = useState<EqBand[]>(() =>
    bands.map((b) => ({ ...b }))
  );
  const [selected, setSelected] = useState(0);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [eqError, setEqError] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Adopt external band changes (settings refresh, reset) unless an
  // edit is in flight - a drag owns the live band state until its
  // dispatch debounce settles.
  useEffect(() => {
    if (!draggingRef.current) setLocalBands(bands.map((b) => ({ ...b })));
  }, [bands]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  // A band edit updates local state immediately (smooth curve) and
  // dispatches set_eq_band debounced, per band.
  const onBandChange = useCallback(
    (index: number, band: EqBand): void => {
      draggingRef.current = true;
      setLocalBands((prev) => {
        const next = prev.slice();
        next[index] = band;
        return next;
      });
      const timers = timersRef.current;
      const existing = timers.get(index);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        index,
        setTimeout(() => {
          timers.delete(index);
          if (timers.size === 0) draggingRef.current = false;
          void setBand(index, band).then((r) => {
            if (!r.ok) setEqError(r.message);
          });
        }, BAND_DISPATCH_DEBOUNCE_MS)
      );
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

  const onReset = useCallback(async (): Promise<void> => {
    setEqError(null);
    const flat = spreadEqBands();
    setLocalBands(flat);
    for (let i = 0; i < flat.length; i++) {
      const r = await setBand(i, flat[i]);
      if (!r.ok) {
        setEqError(r.message);
        return;
      }
    }
  }, [setBand]);

  return (
    <div className="audio-eq">
      <label className="settings-label" htmlFor="audio-eq-enable">
        <span>Parametric EQ</span>
        <input
          id="audio-eq-enable"
          type="checkbox"
          className="audio-toggle"
          checked={modeActive}
          disabled={locked || modeBusy}
          onChange={() => void onToggleMode()}
        />
      </label>
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
