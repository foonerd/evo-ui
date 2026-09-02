// Themed, DOM-rendered dropdown - the controlled replacement for the
// native <select>. A native select's option popup is drawn by the browser
// engine and is NOT reliably styleable: it renders acceptably in Chromium
// but as a raw/white-on-white widget on the kiosk's WPE WebKit. This
// component owns every pixel (trigger + list), so it renders identically
// on the remote browser and the attached glass, is touch-friendly, and is
// keyboard-accessible (listbox pattern). No native form control, no
// engine-drawn popup.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { ChevronDown } from "lucide-preact";

export interface EvoSelectOption {
  value: string;
  label: string;
}

export function EvoSelect(props: {
  value: string;
  options: EvoSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}): JSX.Element {
  const { value, options, onChange, disabled, ariaLabel, className } = props;
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // Close on outside pointer-down and on scroll/resize (the list is
  // absolutely positioned; keeping it pinned to a moving trigger is not
  // worth a portal here - dismiss instead).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onDismiss = (): void => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [open]);

  const commit = useCallback(
    (v: string): void => {
      onChange(v);
      setOpen(false);
    },
    [onChange]
  );

  const openAtCurrent = useCallback((): void => {
    setActiveIdx(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }, [options, value]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openAtCurrent();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < options.length) {
        commit(options[activeIdx].value);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={
        "evo-select" +
        (open ? " evo-select-open" : "") +
        (className ? " " + className : "")
      }
    >
      <button
        type="button"
        className="evo-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openAtCurrent())}
        onKeyDown={onKeyDown}
      >
        <span className="evo-select-value">
          {selected !== null ? selected.label : ""}
        </span>
        <ChevronDown size={14} className="evo-select-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul className="evo-select-list" role="listbox">
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={
                "evo-select-option" +
                (o.value === value ? " is-selected" : "") +
                (i === activeIdx ? " is-active" : "")
              }
              onPointerDown={(e) => {
                e.preventDefault();
                commit(o.value);
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
