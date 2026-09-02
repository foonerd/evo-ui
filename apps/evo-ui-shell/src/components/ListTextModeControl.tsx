// ListTextModeControl - the per-surface "Aa" long-text button of the
// ruled list-element standard. Cycles System -> Scroll -> Wrap ->
// Truncate for ONE list surface; the active mode is exposed via
// title/aria (and a data-mode hook for the override tint).
//
// "System" is not a fourth behaviour: it means "follow the device's
// Long text setting" (App's titleOverflowMode). The override is a
// DEVICE setting (ui.list.text_mode.<surface>); "system" is never
// stored - returning to it patches the key away (null).

import type { TextOverflowMode } from "./ScrollingText";
import type { MessageKey } from "../locales/en";
import { t } from "../runtime/i18n";

export type ListTextModeOverride = "system" | TextOverflowMode;

const CYCLE: readonly ListTextModeOverride[] = [
  "system",
  "scroll",
  "wrap",
  "truncate"
];

export function isListTextModeOverride(v: unknown): v is ListTextModeOverride {
  return v === "system" || v === "scroll" || v === "wrap" || v === "truncate";
}

/** Resolve the stored override against the device-wide Long text
 *  setting. This resolved mode is what TrackTile consumes. */
export function resolveListTextMode(
  override: ListTextModeOverride,
  systemMode: TextOverflowMode
): TextOverflowMode {
  return override === "system" ? systemMode : override;
}

interface ListTextModeControlProps {
  value: ListTextModeOverride;
  onChange: (mode: ListTextModeOverride) => void;
}

export function ListTextModeControl({ value, onChange }: ListTextModeControlProps) {
  const label = `${t("list.textMode")}: ${t(`list.mode.${value}` as MessageKey)}`;
  const next = CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
  return (
    <button
      type="button"
      className="list-aa"
      data-mode={value}
      onClick={() => onChange(next)}
      title={label}
      aria-label={label}
    >
      Aa
    </button>
  );
}
