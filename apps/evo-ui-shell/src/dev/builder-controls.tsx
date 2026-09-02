// Shared builder chrome controls - ONE implementation for the stage,
// menu, and pages builders (the v7 pattern applied everywhere).
// Steppers, segmented choices, labeled groups with help text, the
// back bar of a settings page, and the element/widget LIBRARY
// overlay. Styling rides the stb-* classes; strings arrive from the
// callers already translated (t() at the call site keeps keys next
// to their surfaces).

import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Search, X } from "lucide-preact";

import { t } from "../runtime/i18n";

export function Stepper(props: {
  value: number; min: number; max: number; step: number;
  fmt?: (v: number) => string; onChange: (v: number) => void;
}): JSX.Element {
  const { value, min, max, step, onChange } = props;
  const fmt = props.fmt ?? ((v: number) => String(v));
  return (
    <span class="stb-stp">
      <button type="button" onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}>-</button>
      <span class="stb-stp-v">{fmt(value)}</span>
      <button type="button" onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))}>+</button>
    </span>
  );
}

export function Seg<T extends string | number>(props: {
  options: readonly T[];
  value: T;
  label?: (v: T) => string;
  disabled?: (v: T) => boolean;
  disabledTitle?: (v: T) => string;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div class="stb-seg">
      {props.options.map((o) => {
        const off = props.disabled?.(o) ?? false;
        return (
          <button key={String(o)} type="button"
            class={props.value === o ? "on" : ""}
            disabled={off}
            title={off ? props.disabledTitle?.(o) : undefined}
            onClick={() => props.onChange(o)}>
            {props.label ? props.label(o) : String(o)}
          </button>
        );
      })}
    </div>
  );
}

export function Lbl(props: { text: string; help?: string }): JSX.Element {
  return (
    <>
      <div class="stb-lbl">{props.text}</div>
      {props.help !== undefined ? <p class="stb-help">{props.help}</p> : null}
    </>
  );
}

/** Settings-page header: back arrow + node title. */
export function BackBar(props: { title: string; onBack: () => void }): JSX.Element {
  return (
    <>
      <div class="stb-back" onClick={props.onBack}>
        &larr; <span>{t("builder.back").toUpperCase()}</span>
      </div>
      <p class="stb-title">{props.title.toUpperCase()}</p>
    </>
  );
}

/* ------------------------- library overlay ------------------------- */

export interface LibraryItem {
  readonly key: string;
  readonly label: string;
  readonly icon?: ComponentChildren;
  /** Secondary note (e.g. envelope range). */
  readonly note?: string;
  /** Contract/marked accent. */
  readonly marked?: boolean;
  readonly disabled?: boolean;
  readonly disabledTitle?: string;
}

export interface LibraryGroup {
  readonly label: string;
  readonly items: readonly LibraryItem[];
}

/** The "+" experience: searchable, categorized overlay. Generic over
 *  what is being added - stage atoms, menu entries, page widgets. */
export function BuilderLibrary(props: {
  title: string;
  groups: readonly LibraryGroup[];
  onPick: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [q, setQ] = useState("");
  const match = (it: LibraryItem) =>
    it.label.toLowerCase().includes(q.toLowerCase());
  return (
    <div class="stb-lib" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="stb-lib-box">
        <div class="stb-lib-head">
          <b>{props.title}</b>
          <span class="stb-lib-search">
            <Search size={13} />
            <input type="text" value={q} placeholder={t("builder.lib.search")}
              onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          </span>
          <button type="button" onClick={props.onClose} aria-label={t("builder.delete")}>
            <X size={14} />
          </button>
        </div>
        {props.groups.map((group) => {
          const visible = group.items.filter(match);
          if (visible.length === 0) return null;
          return (
            <div key={group.label}>
              <h4>{group.label}</h4>
              <div class="stb-lib-grid">
                {visible.map((it) => (
                  <button key={it.key} type="button"
                    class={"stb-lib-el" + (it.marked === true ? " stb-contract" : "")}
                    disabled={it.disabled === true}
                    title={it.disabled === true ? it.disabledTitle : undefined}
                    onClick={() => props.onPick(it.key)}>
                    {it.icon}
                    <span>{it.label}</span>
                    {it.note !== undefined ? <small class="stb-lib-note">{it.note}</small> : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
