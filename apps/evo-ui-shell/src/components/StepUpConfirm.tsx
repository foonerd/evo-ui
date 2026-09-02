// StepUpConfirm - THE generalised guarded confirm (plan Phase 1c,
// ruled on the attention-surfaces sheet). Any dispatch site that
// gates a privileged verb renders this instead of inventing its own
// modal. Pixel-identical to the approved power confirm: icon +
// title + one-line consequence + inline refusal + Cancel/Confirm.
//
// GUARDED semantics: rides the step-up band with NO dismiss path -
// ESC and backdrop do nothing; only the two buttons resolve it.
// The busy state disables both buttons while the dispatch is in
// flight.

import { AttentionOverlay } from "./AttentionLayer";
import type { ComponentChildren, JSX } from "preact";
import { t } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";

export interface StepUpConfirmProps {
  /** Icon rendered in the circular badge. */
  icon: ComponentChildren;
  /** Danger styling: red badge + red confirm button. */
  danger?: boolean;
  title: string;
  /** One-line consequence text under the title. */
  body: string;
  /** Inline refusal / failure message, or null. */
  error?: string | null;
  busy?: boolean;
  confirmLabel: string;
  /** Small icon inside the confirm button (matches the approved
   *  power confirm's button anatomy). */
  confirmIcon?: ComponentChildren;
  cancelLabel?: string;
  /** Extra content between the body and the actions (rare). */
  children?: ComponentChildren;
  ariaLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StepUpConfirm({
  icon,
  danger = false,
  title,
  body,
  error = null,
  busy = false,
  confirmLabel,
  confirmIcon,
  cancelLabel,
  children,
  ariaLabel,
  onCancel,
  onConfirm
}: StepUpConfirmProps): JSX.Element {
  useLocale();
  return (
    <AttentionOverlay
      band="stepup"
      className="sys-confirm-root"
      role="alertdialog"
      ariaLabel={ariaLabel}
    >
      <div className="sys-confirm-card">
        <span
          className={danger ? "sys-confirm-ic sys-confirm-ic-danger" : "sys-confirm-ic"}
          aria-hidden
        >
          {icon}
        </span>
        <h4>{title}</h4>
        <p>{body}</p>
        {children}
        {error !== null ? (
          <div className="audio-options-setter-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <div className="sys-confirm-actions">
          <button
            type="button"
            className="sys-confirm-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? t("dialog.cancel")}
          </button>
          <button
            type="button"
            className={danger ? "sys-confirm-go-danger" : "sys-confirm-go"}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmIcon}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </AttentionOverlay>
  );
}
