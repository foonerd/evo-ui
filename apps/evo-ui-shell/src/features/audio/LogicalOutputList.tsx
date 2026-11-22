// LogicalOutputList - the named outputs under the physical rows on the
// output stage: one list of names in the answer's order, an Add line, and
// Update and Remove on each named row.
//
// Add asks for a name and one physical output the stage already lists,
// then sends the helper's add payload and nothing else; an empty name is
// never sent. Update opens the row in place and sends that row's id with
// the new name, the new physical output, or both; an unchanged row sends
// nothing. Remove asks first; confirm sends the row's id only, cancel
// sends nothing. After each answer the list on screen is that answer -
// the hook applies it; this component never re-reads.
//
// A named output is not played, paused, enabled, disabled, or given a
// volume from here: none of those controls exist on a named row. The
// physical rows above keep their five controls and their hw:N,M ids, and
// the picker stays the picker. A refusal is shown under this list.

import { useState } from "preact/hooks";
import { Pencil, Trash2 } from "lucide-preact";
import type { AlsaOutput } from "./audio-options-decoders";
import {
  addLogicalOutputPayload,
  removeLogicalOutputPayload,
  updateLogicalOutputPayload,
  type AddLogicalOutputPayload,
  type LogicalOutput,
  type RemoveLogicalOutputPayload,
  type UpdateLogicalOutputPayload
} from "./logical-output-verbs";
import type { LogicalOutputVerbResult } from "./useAudioOptions";
import { ConfirmDialog } from "../../components/dialogs";
import { EvoSelect } from "../../components/EvoSelect";
import { t } from "../../runtime/i18n";

interface LogicalOutputListProps {
  /** The named outputs, in the answer's order. */
  rows: ReadonlyArray<LogicalOutput>;
  /** The physical outputs the stage lists; a name points at one of them. */
  outputs: ReadonlyArray<AlsaOutput>;
  disabled: boolean;
  onAdd: (payload: AddLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
  onUpdate: (payload: UpdateLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
  onRemove: (payload: RemoveLogicalOutputPayload) => Promise<LogicalOutputVerbResult>;
}

/** The physical rows as picker options, plus the row's current output
 *  when the stage does not list it right now, so an edit can keep it. */
function targetOptions(
  outputs: ReadonlyArray<AlsaOutput>,
  keep: string | null
): Array<{ value: string; label: string }> {
  const options = outputs.map((o) => ({ value: o.alsaId, label: o.label }));
  if (keep !== null && keep.length > 0 && !outputs.some((o) => o.alsaId === keep)) {
    options.unshift({ value: keep, label: t("audioopt.namedNotListed", { id: keep }) });
  }
  return options;
}

export function LogicalOutputList(props: LogicalOutputListProps) {
  const { rows, outputs, disabled } = props;
  const [addName, setAddName] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [removeAsk, setRemoveAsk] = useState<LogicalOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = disabled || busy;
  // The add picker defaults to the first listed physical output when the
  // operator has not picked one.
  const addTargetValue =
    addTarget.length > 0 && outputs.some((o) => o.alsaId === addTarget)
      ? addTarget
      : (outputs[0]?.alsaId ?? "");
  const addPayload = addLogicalOutputPayload(addName, addTargetValue);

  const onAddClick = async (): Promise<void> => {
    const payload = addLogicalOutputPayload(addName, addTargetValue);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onAdd(payload);
    setBusy(false);
    if (r.ok) {
      setAddName("");
    } else {
      setError(r.message);
    }
  };

  const startEdit = (row: LogicalOutput): void => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditTarget(row.outputId);
    setError(null);
  };

  const onSaveEdit = async (row: LogicalOutput): Promise<void> => {
    const payload = updateLogicalOutputPayload(row, { name: editName, outputId: editTarget });
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onUpdate(payload);
    setBusy(false);
    if (r.ok) {
      setEditingId(null);
    } else {
      setError(r.message);
    }
  };

  const onRemoveConfirm = async (): Promise<void> => {
    if (removeAsk === null) return;
    const payload = removeLogicalOutputPayload(removeAsk.id);
    setRemoveAsk(null);
    setBusy(true);
    setError(null);
    const r = await props.onRemove(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  const targetLabel = (outputId: string): string =>
    outputs.find((o) => o.alsaId === outputId)?.label ??
    t("audioopt.namedNotListed", { id: outputId });

  return (
    <div className="audio-named-outputs">
      <p className="audio-dsp-title">{t("audioopt.namedOutputs")}</p>
      {rows.length === 0 ? (
        <p className="audio-named-outputs-empty">{t("audioopt.namedEmpty")}</p>
      ) : (
        <ul className="audio-named-output-rows">
          {rows.map((row) =>
            editingId === row.id ? (
              <li key={row.id} className="audio-named-output-row">
                <div className="audio-eq-preset-line audio-named-output-edit">
                  <label className="audio-eq-preset-field" htmlFor={`audio-named-edit-${row.id}`}>
                    <span>{t("audioopt.namedName")}</span>
                    <input
                      id={`audio-named-edit-${row.id}`}
                      type="text"
                      value={editName}
                      maxLength={64}
                      disabled={locked}
                      onInput={(ev) => setEditName((ev.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label className="audio-eq-preset-field">
                    <span>{t("audioopt.namedTarget")}</span>
                    <EvoSelect
                      ariaLabel={t("audioopt.namedTarget")}
                      value={editTarget}
                      disabled={locked}
                      options={targetOptions(outputs, row.outputId)}
                      onChange={(v) => setEditTarget(v)}
                    />
                  </label>
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={
                      locked ||
                      updateLogicalOutputPayload(row, { name: editName, outputId: editTarget }) === null
                    }
                    onClick={() => void onSaveEdit(row)}
                  >
                    {t("audioopt.namedSave")}
                  </button>
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    {t("dialog.cancel")}
                  </button>
                </div>
              </li>
            ) : (
              <li key={row.id} className="audio-named-output-row">
                <span className="audio-named-output-name">{row.name}</span>
                <span className="audio-named-output-target">{targetLabel(row.outputId)}</span>
                <span className="audio-named-output-id">{row.outputId}</span>
                <span className="audio-named-output-actions">
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={locked}
                    onClick={() => startEdit(row)}
                    title={t("audioopt.namedUpdate")}
                  >
                    <Pencil size={14} /> {t("audioopt.namedUpdate")}
                  </button>
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={locked}
                    onClick={() => setRemoveAsk(row)}
                    title={t("audioopt.namedRemove")}
                  >
                    <Trash2 size={14} /> {t("audioopt.namedRemove")}
                  </button>
                </span>
              </li>
            )
          )}
        </ul>
      )}

      <div className="audio-eq-preset-line audio-named-output-add">
        <label className="audio-eq-preset-field" htmlFor="audio-named-add-name">
          <span>{t("audioopt.namedName")}</span>
          <input
            id="audio-named-add-name"
            type="text"
            value={addName}
            placeholder={t("audioopt.namedNamePlaceholder")}
            maxLength={64}
            disabled={locked || outputs.length === 0}
            onInput={(ev) => setAddName((ev.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label className="audio-eq-preset-field">
          <span>{t("audioopt.namedTarget")}</span>
          <EvoSelect
            ariaLabel={t("audioopt.namedTarget")}
            value={addTargetValue}
            disabled={locked || outputs.length === 0}
            options={targetOptions(outputs, null)}
            onChange={(v) => setAddTarget(v)}
          />
        </label>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={locked || addPayload === null}
          onClick={() => void onAddClick()}
        >
          {t("audioopt.namedAdd")}
        </button>
      </div>

      {error !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {removeAsk !== null ? (
        <ConfirmDialog
          title={t("audioopt.namedRemoveTitle")}
          message={t("audioopt.namedRemoveAsk", { name: removeAsk.name })}
          confirmLabel={t("audioopt.namedRemove")}
          destructive
          onConfirm={() => void onRemoveConfirm()}
          onCancel={() => setRemoveAsk(null)}
        />
      ) : null}
    </div>
  );
}
