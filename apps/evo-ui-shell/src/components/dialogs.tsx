// In-app dialog primitives. Replaces window.prompt / window.confirm /
// window.alert across the shell - browser-default dialogs were a
// kiosk-grade defect (no list of available choices, no styling, no
// focus management, no accessibility).
//
// Three specialised variants on a shared Modal base:
//   - ConfirmDialog: yes/no confirmations with optional destructive
//     styling for irreversible actions.
//   - PromptDialog: single-line text input with a label.
//   - PlaylistPickerDialog: scrollable list of existing playlists +
//     optional "new playlist" inline affordance. The whole point of
//     this work is that operators never have to type a playlist name
//     from memory.
//
// All three return a Promise<T | null> via the resolve callback - null
// when the operator cancels. Components are uncontrolled wrt their
// open state; the caller mounts the component conditionally and
// resolves on confirm or cancel.

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AttentionOverlay } from "./AttentionLayer";
import { ListMusic, X } from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import type { PlaylistIndexEntry } from "../features/playlist/playlist-decoders";
import { formatRelativeMs } from "../features/playlist/playlist-decoders";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";

// ---- Modal primitive --------------------------------------------------

interface ModalProps {
  title: string;
  onCancel: () => void;
  children: ComponentChildren;
}

/** Modal overlay + card. Closes on ESC and on backdrop click. The
 *  primary content (form / list) goes in children; the actions row is
 *  the responsibility of the specialised dialog. */
export function Modal({ title, onCancel, children }: ModalProps): JSX.Element {
  useLocale();
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Focus the card on mount so keyboard input is captured by the
  // dialog rather than the underlying surface. The card itself is
  // focusable via tabIndex={-1}. (The AttentionOverlay restores
  // focus to whatever held it when the dialog closes.)
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // Rides the attention layer (law L1): body portal, dialog z-band,
  // ESC + backdrop dismissal, focus custody - all owned centrally.
  return (
    <AttentionOverlay
      band="dialog"
      className="evo-modal-root"
      onDismiss={onCancel}
      dismissOnBackdrop
    >
      <div
        ref={cardRef}
        className="evo-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="evo-modal-head">
          <h4 className="evo-modal-title">{title}</h4>
          <button
            type="button"
            className="evo-modal-close"
            onClick={onCancel}
            aria-label={t("dialog.close")}
            title={t("dialog.close")}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </AttentionOverlay>
  );
}

// ---- ConfirmDialog -----------------------------------------------------

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = t("dialog.confirm"),
  cancelLabel = t("dialog.cancel"),
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  useLocale();
  return (
    <Modal title={title} onCancel={onCancel}>
      <p className="evo-modal-body">{message}</p>
      <div className="evo-modal-actions">
        <button
          type="button"
          className="evo-modal-button evo-modal-button-secondary"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={
            destructive
              ? "evo-modal-button evo-modal-button-danger"
              : "evo-modal-button evo-modal-button-primary"
          }
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---- PromptDialog ------------------------------------------------------

interface PromptDialogProps {
  title: string;
  /** Label rendered above the input. */
  label: string;
  /** Initial input value. Useful for rename flows. */
  initialValue?: string;
  /** Hint shown below the input. */
  hint?: string;
  /** Placeholder text. */
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called with the trimmed input value when the operator confirms. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  hint,
  placeholder,
  confirmLabel = t("dialog.ok"),
  cancelLabel = t("dialog.cancel"),
  onConfirm,
  onCancel
}: PromptDialogProps): JSX.Element {
  useLocale();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  }, [value, onConfirm]);

  return (
    <Modal title={title} onCancel={onCancel}>
      <form
        className="evo-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="evo-modal-label">
          {label}
          <input
            ref={inputRef}
            className="evo-modal-input"
            type="text"
            value={value}
            placeholder={placeholder}
            onInput={(event) =>
              setValue((event.currentTarget as HTMLInputElement).value)
            }
          />
        </label>
        {hint ? <p className="evo-modal-hint">{hint}</p> : null}
        <div className="evo-modal-actions">
          <button
            type="button"
            className="evo-modal-button evo-modal-button-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="evo-modal-button evo-modal-button-primary"
            disabled={value.trim().length === 0}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- PlaylistPickerDialog ---------------------------------------------

interface PlaylistPickerDialogProps {
  title: string;
  /** Short hint shown above the list. */
  hint?: string;
  /** The playlist index from usePlaylists. May be empty. */
  playlists: PlaylistIndexEntry[];
  /** Label for the primary action button. */
  confirmLabel?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function PlaylistPickerDialog({
  title,
  hint,
  playlists,
  confirmLabel = t("dialog.ok"),
  onConfirm,
  onCancel
}: PlaylistPickerDialogProps): JSX.Element {
  useLocale();
  const [selected, setSelected] = useState<string | null>(null);

  // Stable sort: most-recently-modified first, then alpha for tiebreak.
  // Useful in workflows like "load the last playlist I just saved".
  const sorted = useMemo(
    () =>
      [...playlists].sort((a, b) => {
        const am = a.modifiedAtMs ?? 0;
        const bm = b.modifiedAtMs ?? 0;
        if (am !== bm) return bm - am;
        return a.name.localeCompare(b.name);
      }),
    [playlists]
  );

  const submit = useCallback(() => {
    if (selected === null) return;
    onConfirm(selected);
  }, [selected, onConfirm]);

  return (
    <Modal title={title} onCancel={onCancel}>
      {hint ? <p className="evo-modal-hint">{hint}</p> : null}
      {sorted.length === 0 ? (
        <div className="evo-picker-empty">
          <ListMusic size={28} />
          <p>{t("dialog.noPlaylists")}</p>
        </div>
      ) : (
        <ul className="evo-picker-list">
          {sorted.map((entry) => {
            const isSelected = entry.name === selected;
            return (
              <li key={entry.name}>
                <button
                  type="button"
                  className={
                    isSelected
                      ? "evo-picker-item evo-picker-item-selected"
                      : "evo-picker-item"
                  }
                  onClick={() => setSelected(entry.name)}
                  onDblClick={() => {
                    setSelected(entry.name);
                    onConfirm(entry.name);
                  }}
                  aria-pressed={isSelected}
                >
                  <span className="evo-picker-name">{entry.name}</span>
                  <span className="evo-picker-meta">
                    {entry.itemCount === 1
                      ? t("dialog.trackCount.one", { n: entry.itemCount })
                      : // null itemCount means "unknown", never "0" - it
                        // renders as an empty placeholder, as before.
                        t("dialog.trackCount.many", {
                          n: entry.itemCount ?? ""
                        })}
                    {entry.modifiedAtMs !== null ? (
                      <>
                        <span className="evo-picker-sep"> - </span>
                        <span>{formatRelativeMs(entry.modifiedAtMs)}</span>
                      </>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="evo-modal-actions">
        <button
          type="button"
          className="evo-modal-button evo-modal-button-secondary"
          onClick={onCancel}
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="evo-modal-button evo-modal-button-primary"
          onClick={submit}
          disabled={selected === null}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
