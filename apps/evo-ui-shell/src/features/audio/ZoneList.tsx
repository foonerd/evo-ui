// ZoneList - the zones under the named outputs on the output stage: one
// list of names in the answer's order, an Add line, and Update and Remove
// on each zone.
//
// A zone is a name over one or more named outputs (logical:<n>) the stage
// already lists. Add asks for a name and a membership picked from those
// names, then sends the helper's add payload and nothing else; an empty
// name or an empty membership is never sent. Update opens the zone in
// place and sends its id with the new name, the new membership, or both;
// an unchanged zone sends nothing. Remove asks first; confirm sends the
// zone's id only, cancel sends nothing. After each answer the list on
// screen is that answer - the hook applies it; this component never
// re-reads.
//
// A physical hw:N,M is never a choice here, and an id another painted
// zone holds is not offered (the zone being edited may keep its own). No
// EQ, no scene, no play, no volume on a zone. A refusal is shown under
// this list.

import { useState } from "preact/hooks";
import { Pencil, Trash2 } from "lucide-preact";
import type { LogicalOutput } from "./logical-output-verbs";
import {
  ZONE_EQ_FREQ_MAX_HZ,
  ZONE_EQ_FREQ_MIN_HZ,
  ZONE_EQ_GAIN_MAX_DB,
  ZONE_EQ_GAIN_MIN_DB,
  ZONE_EQ_Q_MAX,
  ZONE_EQ_Q_MIN,
  addZonePayload,
  removeZonePayload,
  updateZonePayload,
  zoneChoices,
  zoneEqBandPayload,
  zoneEqEngagedPayload,
  type AddZonePayload,
  type RemoveZonePayload,
  type UpdateZonePayload,
  type Zone,
  type ZoneEqBand,
  type ZoneEqBandPayload,
  type ZoneEqEngagedPayload
} from "./zone-verbs";
import type { ZoneVerbResult } from "./useAudioOptions";
import { ConfirmDialog } from "../../components/dialogs";
import { t } from "../../runtime/i18n";

interface ZoneListProps {
  /** The zones, in the answer's order. */
  rows: ReadonlyArray<Zone>;
  /** The named outputs on screen; a zone holds some of them. */
  logicalOutputs: ReadonlyArray<LogicalOutput>;
  disabled: boolean;
  onAdd: (payload: AddZonePayload) => Promise<ZoneVerbResult>;
  onUpdate: (payload: UpdateZonePayload) => Promise<ZoneVerbResult>;
  onRemove: (payload: RemoveZonePayload) => Promise<ZoneVerbResult>;
  /** The zone's own stored EQ (G3), on the zone being edited. Not the
   *  global EQ; selects no composition mode. */
  onSetEqEngaged: (payload: ZoneEqEngagedPayload) => Promise<ZoneVerbResult>;
  onSetEqBand: (payload: ZoneEqBandPayload) => Promise<ZoneVerbResult>;
}

function toggle(list: ReadonlyArray<string>, id: string, on: boolean): string[] {
  const without = list.filter((v) => v !== id);
  return on ? [...without, id] : without;
}

export function ZoneList(props: ZoneListProps) {
  const { rows, logicalOutputs, disabled } = props;
  const [addName, setAddName] = useState("");
  const [addPicked, setAddPicked] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [removeAsk, setRemoveAsk] = useState<Zone | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = disabled || busy;
  const addChoices = zoneChoices(logicalOutputs, rows, null);
  // A choice that left the screen (or was taken by another zone) is not
  // sent: the membership is what is still choosable.
  const addMembers = addPicked.filter((id) => addChoices.some((c) => c.id === id));
  const addPayload = addZonePayload(addName, addMembers);

  const onAddClick = async (): Promise<void> => {
    const payload = addZonePayload(addName, addMembers);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onAdd(payload);
    setBusy(false);
    if (r.ok) {
      setAddName("");
      setAddPicked([]);
    } else {
      setError(r.message);
    }
  };

  const startEdit = (zone: Zone): void => {
    setEditingId(zone.id);
    setEditName(zone.name);
    setEditMembers([...zone.logicalOutputIds]);
    setError(null);
  };

  const onSaveEdit = async (zone: Zone): Promise<void> => {
    const payload = updateZonePayload(zone, { name: editName, logicalOutputIds: editMembers });
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

  // The stored EQ on the zone being edited. The flag and each band send
  // only when they change and are in range (the helper decides); the
  // answer replaces the zone and the inputs follow it. A band writes on
  // change (release), never per keystroke.
  const onEqEngaged = async (zone: Zone, engaged: boolean): Promise<void> => {
    const payload = zoneEqEngagedPayload(zone, engaged);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onSetEqEngaged(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  const onEqBand = async (zone: Zone, index: number, band: ZoneEqBand): Promise<void> => {
    const payload = zoneEqBandPayload(zone, index, band);
    if (payload === null) return;
    setBusy(true);
    setError(null);
    const r = await props.onSetEqBand(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  const onRemoveConfirm = async (): Promise<void> => {
    if (removeAsk === null) return;
    const payload = removeZonePayload(removeAsk.id);
    setRemoveAsk(null);
    setBusy(true);
    setError(null);
    const r = await props.onRemove(payload);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  const memberLabel = (id: string): string =>
    logicalOutputs.find((o) => o.id === id)?.name ?? t("audioopt.zoneNotListed", { id });

  const renderChoices = (
    choices: ReadonlyArray<{ id: string; label: string }>,
    chosen: ReadonlyArray<string>,
    onToggle: (id: string, on: boolean) => void,
    prefix: string
  ) =>
    choices.length === 0 ? (
      <span className="audio-zone-no-choices">{t("audioopt.zoneNoChoices")}</span>
    ) : (
      <span className="audio-zone-choices" role="group" aria-label={t("audioopt.zoneMembers")}>
        {choices.map((c) => (
          <label key={c.id} className="audio-zone-choice" htmlFor={`${prefix}-${c.id}`}>
            <input
              id={`${prefix}-${c.id}`}
              type="checkbox"
              checked={chosen.includes(c.id)}
              disabled={locked}
              onChange={(ev) => onToggle(c.id, (ev.currentTarget as HTMLInputElement).checked)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </span>
    );

  return (
    <div className="audio-zones">
      <p className="audio-dsp-title">{t("audioopt.zones")}</p>
      {rows.length === 0 ? (
        <p className="audio-named-outputs-empty">{t("audioopt.zonesEmpty")}</p>
      ) : (
        <ul className="audio-named-output-rows">
          {rows.map((zone) =>
            editingId === zone.id ? (
              <li key={zone.id} className="audio-named-output-row">
                <div className="audio-eq-preset-line audio-named-output-edit">
                  <label className="audio-eq-preset-field" htmlFor={`audio-zone-edit-${zone.id}`}>
                    <span>{t("audioopt.zoneName")}</span>
                    <input
                      id={`audio-zone-edit-${zone.id}`}
                      type="text"
                      value={editName}
                      maxLength={64}
                      disabled={locked}
                      onInput={(ev) => setEditName((ev.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <span className="audio-eq-preset-field">
                    <span>{t("audioopt.zoneMembers")}</span>
                    {renderChoices(
                      zoneChoices(logicalOutputs, rows, zone.id),
                      editMembers,
                      (id, on) => setEditMembers((cur) => toggle(cur, id, on)),
                      `audio-zone-edit-${zone.id}`
                    )}
                  </span>
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={
                      locked ||
                      updateZonePayload(zone, { name: editName, logicalOutputIds: editMembers }) === null
                    }
                    onClick={() => void onSaveEdit(zone)}
                  >
                    {t("audioopt.zoneSave")}
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
                <div className="audio-zone-eq">
                  <p className="audio-dsp-title">{t("audioopt.zoneEq")}</p>
                  <label className="audio-zone-choice" htmlFor={`audio-zone-eq-on-${zone.id}`}>
                    <input
                      id={`audio-zone-eq-on-${zone.id}`}
                      type="checkbox"
                      checked={zone.eq.engaged}
                      disabled={locked}
                      onChange={(ev) =>
                        void onEqEngaged(zone, (ev.currentTarget as HTMLInputElement).checked)
                      }
                    />
                    <span>{t("audioopt.zoneEqOn")}</span>
                  </label>
                  <ul className="audio-zone-eq-bands">
                    {zone.eq.bands.map((band, index) => {
                      const field = (
                        key: "freqHz" | "gainDb" | "q",
                        label: string,
                        min: number,
                        max: number,
                        step: number
                      ) => (
                        <label className="audio-zone-eq-field" htmlFor={`audio-zone-eq-${zone.id}-${index}-${key}`}>
                          <span>{label}</span>
                          <input
                            id={`audio-zone-eq-${zone.id}-${index}-${key}`}
                            type="number"
                            min={min}
                            max={max}
                            step={step}
                            value={band[key]}
                            disabled={locked}
                            onChange={(ev) =>
                              void onEqBand(zone, index, {
                                ...band,
                                [key]: Number((ev.currentTarget as HTMLInputElement).value)
                              })
                            }
                          />
                        </label>
                      );
                      return (
                        <li key={index} className="audio-zone-eq-band">
                          <span className="audio-zone-eq-band-name">{t("audioopt.zoneEqBand", { n: index + 1 })}</span>
                          {field("freqHz", t("audioopt.zoneEqFreq"), ZONE_EQ_FREQ_MIN_HZ, ZONE_EQ_FREQ_MAX_HZ, 1)}
                          {field("gainDb", t("audioopt.zoneEqGain"), ZONE_EQ_GAIN_MIN_DB, ZONE_EQ_GAIN_MAX_DB, 0.5)}
                          {field("q", t("audioopt.zoneEqQ"), ZONE_EQ_Q_MIN, ZONE_EQ_Q_MAX, 0.1)}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="audio-zone-no-choices">{t("audioopt.zoneEqStoredNote")}</p>
                </div>
                {/* end audio-zone-eq */}
              </li>
            ) : (
              <li key={zone.id} className="audio-named-output-row">
                <span className="audio-named-output-name">{zone.name}</span>
                <span className="audio-named-output-target">
                  {zone.logicalOutputIds.map(memberLabel).join(", ")}
                </span>
                <span className="audio-named-output-id">{zone.id}</span>
                <span className="audio-named-output-actions">
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={locked}
                    onClick={() => startEdit(zone)}
                    title={t("audioopt.zoneUpdate")}
                  >
                    <Pencil size={14} /> {t("audioopt.zoneUpdate")}
                  </button>
                  <button
                    type="button"
                    className="audio-eq-preset-btn"
                    disabled={locked}
                    onClick={() => setRemoveAsk(zone)}
                    title={t("audioopt.zoneRemove")}
                  >
                    <Trash2 size={14} /> {t("audioopt.zoneRemove")}
                  </button>
                </span>
              </li>
            )
          )}
        </ul>
      )}

      <div className="audio-eq-preset-line audio-named-output-add">
        <label className="audio-eq-preset-field" htmlFor="audio-zone-add-name">
          <span>{t("audioopt.zoneName")}</span>
          <input
            id="audio-zone-add-name"
            type="text"
            value={addName}
            placeholder={t("audioopt.zoneNamePlaceholder")}
            maxLength={64}
            disabled={locked || addChoices.length === 0}
            onInput={(ev) => setAddName((ev.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <span className="audio-eq-preset-field">
          <span>{t("audioopt.zoneMembers")}</span>
          {renderChoices(
            addChoices,
            addMembers,
            (id, on) => setAddPicked((cur) => toggle(cur, id, on)),
            "audio-zone-add"
          )}
        </span>
        <button
          type="button"
          className="audio-eq-preset-btn"
          disabled={locked || addPayload === null}
          onClick={() => void onAddClick()}
        >
          {t("audioopt.zoneAdd")}
        </button>
      </div>

      {error !== null ? (
        <div className="audio-options-setter-error" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      {removeAsk !== null ? (
        <ConfirmDialog
          title={t("audioopt.zoneRemoveTitle")}
          message={t("audioopt.zoneRemoveAsk", { name: removeAsk.name })}
          confirmLabel={t("audioopt.zoneRemove")}
          destructive
          onConfirm={() => void onRemoveConfirm()}
          onCancel={() => setRemoveAsk(null)}
        />
      ) : null}
    </div>
  );
}
