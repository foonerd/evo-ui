// EqPresetRow - the named-EQ-preset controls in the EQ panel.
//
// Presets are device-side: the four options.*_eq_preset verbs store
// the library in the same persistence as eq_bands. Recall applies a
// preset's 10 bands atomically; the recalled curve flows back into
// the editor through the audio.options.changed happening. Export
// and import are UI-side - the library serialises to a downloaded
// JSON file, and import saves each entry back through save.

import { t } from "../../runtime/i18n";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  serialiseEqPresetLibrary,
  parseEqPresetLibrary,
  type EqBand,
  type EqPreset
} from "./eq-decoders";
import type { AudioSetterResult } from "./useAudioOptions";
import { EvoSelect } from "../../components/EvoSelect";

interface EqPresetRowProps {
  /** The bands a Save would capture. */
  currentBands: ReadonlyArray<EqBand>;
  disabled: boolean;
  onList: () => Promise<ReadonlyArray<EqPreset>>;
  onSave: (
    name: string,
    bands: ReadonlyArray<EqBand>
  ) => Promise<AudioSetterResult>;
  onRecall: (name: string) => Promise<AudioSetterResult>;
  onDelete: (name: string) => Promise<AudioSetterResult>;
}

export function EqPresetRow({
  currentBands,
  disabled,
  onList,
  onSave,
  onRecall,
  onDelete
}: EqPresetRowProps) {
  const [presets, setPresets] = useState<ReadonlyArray<EqPreset>>([]);
  const [selected, setSelected] = useState("");
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  const refreshList = useCallback(async (): Promise<void> => {
    const list = await onList();
    if (!cancelledRef.current) setPresets(list);
  }, [onList]);

  useEffect(() => {
    cancelledRef.current = false;
    void refreshList();
    return () => {
      cancelledRef.current = true;
    };
  }, [refreshList]);

  const onRecallPick = async (name: string): Promise<void> => {
    setSelected(name);
    if (name === "") return;
    setBusy(true);
    setStatus(null);
    const r = await onRecall(name);
    setBusy(false);
    setStatus(
      r.ok
        ? { ok: true, message: `Recalled "${name}".` }
        : { ok: false, message: r.message }
    );
  };

  const onSaveClick = async (): Promise<void> => {
    const name = saveName.trim();
    if (name.length === 0) return;
    setBusy(true);
    setStatus(null);
    const r = await onSave(name, currentBands);
    setBusy(false);
    if (r.ok) {
      setSaveName("");
      setStatus({ ok: true, message: `Saved "${name}".` });
      await refreshList();
    } else {
      setStatus({ ok: false, message: r.message });
    }
  };

  const onDeleteClick = async (): Promise<void> => {
    if (selected === "") return;
    setBusy(true);
    setStatus(null);
    const r = await onDelete(selected);
    setBusy(false);
    if (r.ok) {
      setStatus({ ok: true, message: `Deleted "${selected}".` });
      setSelected("");
      await refreshList();
    } else {
      setStatus({ ok: false, message: r.message });
    }
  };

  const onExport = (): void => {
    const blob = new Blob([serialiseEqPresetLibrary(presets)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "evo-eq-presets.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    setBusy(true);
    setStatus(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setBusy(false);
      setStatus({ ok: false, message: t("eq.readFail") });
      return;
    }
    const lib = parseEqPresetLibrary(text);
    if (lib === null) {
      setBusy(false);
      setStatus({
        ok: false,
        message: t("eq.invalidExport")
      });
      return;
    }
    let saved = 0;
    for (const p of lib) {
      const r = await onSave(p.name, p.bands);
      if (!r.ok) {
        setBusy(false);
        setStatus({ ok: false, message: `Import stopped: ${r.message}` });
        await refreshList();
        return;
      }
      saved += 1;
    }
    setBusy(false);
    await refreshList();
    setStatus({
      ok: true,
      message: `Imported ${saved} preset${saved === 1 ? "" : "s"}.`
    });
  };

  return (
    <div className="audio-eq-presets">
      <div className="audio-eq-preset-line">
        <label className="audio-eq-preset-field" htmlFor="eq-preset-recall">
          <span>Preset</span>
          <EvoSelect
            ariaLabel="Preset"
            value={selected}
            disabled={disabled || busy}
            options={[
              {
                value: "",
                label:
                  presets.length === 0
                    ? t("eq.noPresets")
                    : t("eq.recallPrompt")
              },
              ...presets.map((p) => ({ value: p.name, label: p.name }))
            ]}
            onChange={(v) => void onRecallPick(v)}
          />
        </label>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={disabled || busy || selected === ""}
          onClick={() => void onDeleteClick()}
        >
          {t("eq.delete")}
        </button>
      </div>

      <div className="audio-eq-preset-line">
        <label className="audio-eq-preset-field" htmlFor="eq-preset-name">
          <span>{t("eq.saveAs")}</span>
          <input
            id="eq-preset-name"
            type="text"
            value={saveName}
            placeholder={t("eq.presetName")}
            maxLength={64}
            disabled={disabled || busy}
            onInput={(ev) =>
              setSaveName((ev.currentTarget as HTMLInputElement).value)
            }
          />
        </label>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={disabled || busy || saveName.trim().length === 0}
          onClick={() => void onSaveClick()}
        >
          Save current
        </button>
      </div>

      <div className="audio-eq-preset-line">
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={busy || presets.length === 0}
          onClick={onExport}
        >
          Export library
        </button>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          Import library
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(ev) =>
            void onImportFile(ev.currentTarget as HTMLInputElement)
          }
        />
      </div>

      {status !== null ? (
        <p
          className={
            status.ok ? "audio-modder-ok" : "audio-options-hint-warning"
          }
          role={status.ok ? "status" : "alert"}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
