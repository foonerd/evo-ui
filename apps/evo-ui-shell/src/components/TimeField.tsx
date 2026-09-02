// Themed HH:MM time control - the controlled replacement for
// <input type="time">, whose native picker is engine-drawn (a broken
// native widget on the kiosk's WPE WebKit). Composed from two EvoSelects
// so it renders identically on the remote browser and the attached glass,
// is touch-friendly, and needs no native form control. Value is a
// zero-padded "HH:MM" string; input is parsed + clamped so it always
// matches an option.

import type { JSX } from "preact";
import { EvoSelect } from "./EvoSelect";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: pad(i),
  label: pad(i)
}));
const MINUTES = Array.from({ length: 60 }, (_, i) => ({
  value: pad(i),
  label: pad(i)
}));

export function TimeField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const { value, onChange, disabled, className } = props;
  const [rawH, rawM] = (value || "").split(":");
  const hh = pad(Math.min(23, Math.max(0, Number(rawH) || 0)));
  const mm = pad(Math.min(59, Math.max(0, Number(rawM) || 0)));
  return (
    <span className={"evo-timefield" + (className ? " " + className : "")}>
      <EvoSelect
        ariaLabel="Hour"
        value={hh}
        disabled={disabled}
        options={HOURS}
        onChange={(v) => onChange(v + ":" + mm)}
      />
      <span className="evo-timefield-sep" aria-hidden="true">:</span>
      <EvoSelect
        ariaLabel="Minute"
        value={mm}
        disabled={disabled}
        options={MINUTES}
        onChange={(v) => onChange(hh + ":" + v)}
      />
    </span>
  );
}
