// SceneList - the scenes under the zone list, in the zone section: one
// list of names in the answer's order, a Save line, and Recall and Remove
// on each name.
//
// A scene is a name and a snapshot of every zone. Save sends the trimmed
// name and nothing else; an empty name is never sent. Saving a name that
// is already listed (in any case) replaces that scene. Recall replaces
// every zone on screen with the scene's zones, so it asks first; Remove
// asks first too. Cancel closes the ask and sends nothing. After each
// answer the hook applies it - this component never re-reads. A refusal
// is shown under this list.

import { useState } from "preact/hooks";
import { RotateCcw, Trash2 } from "lucide-preact";
import { sceneNamePayload, type SceneNamePayload } from "./scene-verbs";
import type { SceneVerbResult } from "./useAudioOptions";
import { ConfirmDialog } from "../../components/dialogs";
import { t } from "../../runtime/i18n";

interface SceneListProps {
  /** The scene names, in the answer's order. */
  rows: ReadonlyArray<string>;
  disabled: boolean;
  onSave: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
  onRecall: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
  onRemove: (payload: SceneNamePayload) => Promise<SceneVerbResult>;
}

export function SceneList(props: SceneListProps) {
  const { rows, disabled } = props;
  const [saveName, setSaveName] = useState("");
  const [recallAsk, setRecallAsk] = useState<string | null>(null);
  const [removeAsk, setRemoveAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = disabled || busy;

  const onSaveClick = async (): Promise<void> => {
    const payload = sceneNamePayload(saveName);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onSave(payload);
    setBusy(false);
    if (r.ok) {
      setSaveName("");
    } else {
      setError(r.message);
    }
  };

  const onRecallConfirm = async (): Promise<void> => {
    if (recallAsk === null) return;
    const payload = sceneNamePayload(recallAsk);
    setRecallAsk(null);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onRecall(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  const onRemoveConfirm = async (): Promise<void> => {
    if (removeAsk === null) return;
    const payload = sceneNamePayload(removeAsk);
    setRemoveAsk(null);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onRemove(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  return (
    <div className="audio-scenes">
      <p className="audio-dsp-title">{t("audioopt.scenes")}</p>
      {rows.length === 0 ? (
        <p className="audio-named-outputs-empty">{t("audioopt.scenesEmpty")}</p>
      ) : (
        <ul className="audio-named-output-rows">
          {rows.map((name) => (
            <li key={name} className="audio-named-output-row">
              <span className="audio-named-output-name">{name}</span>
              <span className="audio-named-output-actions">
                <button
                  type="button"
                  className="audio-eq-preset-btn"
                  disabled={locked}
                  onClick={() => setRecallAsk(name)}
                  title={t("audioopt.sceneRecall")}
                >
                  <RotateCcw size={14} /> {t("audioopt.sceneRecall")}
                </button>
                <button
                  type="button"
                  className="audio-eq-preset-btn"
                  disabled={locked}
                  onClick={() => setRemoveAsk(name)}
                  title={t("audioopt.sceneRemove")}
                >
                  <Trash2 size={14} /> {t("audioopt.sceneRemove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="audio-eq-preset-line audio-named-output-add">
        <label className="audio-eq-preset-field" htmlFor="audio-scene-save-name">
          <span>{t("audioopt.sceneName")}</span>
          <input
            id="audio-scene-save-name"
            type="text"
            value={saveName}
            placeholder={t("audioopt.sceneNamePlaceholder")}
            maxLength={64}
            disabled={locked}
            onInput={(ev) => setSaveName((ev.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={locked || sceneNamePayload(saveName) === null}
          onClick={() => void onSaveClick()}
        >
          {t("audioopt.sceneSave")}
        </button>
      </div>
      <p className="audio-zone-no-choices">{t("audioopt.sceneSaveNote")}</p>

      {error !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {recallAsk !== null ? (
        <ConfirmDialog
          title={t("audioopt.sceneRecallTitle")}
          message={t("audioopt.sceneRecallAsk", { name: recallAsk })}
          confirmLabel={t("audioopt.sceneRecall")}
          destructive
          onConfirm={() => void onRecallConfirm()}
          onCancel={() => setRecallAsk(null)}
        />
      ) : null}

      {removeAsk !== null ? (
        <ConfirmDialog
          title={t("audioopt.sceneRemoveTitle")}
          message={t("audioopt.sceneRemoveAsk", { name: removeAsk })}
          confirmLabel={t("audioopt.sceneRemove")}
          destructive
          onConfirm={() => void onRemoveConfirm()}
          onCancel={() => setRemoveAsk(null)}
        />
      ) : null}
    </div>
  );
}
