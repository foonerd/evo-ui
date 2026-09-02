// AttentionLayer - THE single overlay primitive (plan law L1).
//
// Every surface that appears over the app (dialogs, step-up
// confirms, user-interaction prompts, notification banners) renders
// through AttentionOverlay. Nothing else may invent its own
// overlay. The primitive owns, once and centrally:
//
//   - the BODY PORTAL: position:fixed overlays are captured by any
//     transformed ancestor (the slide drawer animates with a CSS
//     transform), so every overlay portals into document.body;
//   - the Z-BAND order (dialog < stepup < prompt < banner) via the
//     .attention-* classes in styles.css - overlays never carry
//     their own z-index;
//   - FOCUS custody: the element focused before the overlay opened
//     is restored when it closes;
//   - ESC-to-dismiss when the overlay is dismissible;
//   - reduced-motion respect: styles.css disables attention-layer
//     animation under prefers-reduced-motion, so consumers animate
//     freely without re-implementing the media query.
//
// Guarded flows (step-up, power confirm) pass no onDismiss - they
// stay open until their own buttons resolve them. Banners are
// non-modal: they must never trap focus (pass modal={false}).

import { useEffect, useRef } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { ComponentChildren, JSX } from "preact";

/** Stacking bands, lowest to highest. A prompt from the framework
 *  must beat the dialog that triggered it; a critical notification
 *  banner must beat everything. */
export type AttentionBand = "dialog" | "stepup" | "prompt" | "banner";

interface AttentionOverlayProps {
  band: AttentionBand;
  /** The overlay root's own class (e.g. evo-modal-root). The band
   *  class is appended automatically. */
  className: string;
  /** Dismiss callback. When present: ESC dismisses, and (if
   *  dismissOnBackdrop) so does a click on the root outside the
   *  content. Absent = guarded overlay, only its own buttons close. */
  onDismiss?: () => void;
  dismissOnBackdrop?: boolean;
  role?: JSX.AriaRole;
  ariaLabel?: string;
  /** Modal overlays announce aria-modal and take focus custody.
   *  Non-modal surfaces (banners) set false. Default true. */
  modal?: boolean;
  children: ComponentChildren;
}

export function AttentionOverlay({
  band,
  className,
  onDismiss,
  dismissOnBackdrop = false,
  role = "presentation",
  ariaLabel,
  modal = true,
  children
}: AttentionOverlayProps): JSX.Element {
  // Focus custody: remember what was focused before the overlay
  // mounted; give it back on unmount. Non-modal overlays (banners)
  // never steal focus, so they have nothing to give back.
  const restoreTo = useRef<Element | null>(null);
  useEffect(() => {
    if (!modal) return undefined;
    restoreTo.current = document.activeElement;
    return () => {
      const el = restoreTo.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [modal]);

  // ESC dismisses dismissible overlays.
  useEffect(() => {
    if (onDismiss === undefined) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div
      className={`${className} attention-${band}`}
      role={role}
      aria-modal={modal ? "true" : undefined}
      aria-label={ariaLabel}
      onClick={
        onDismiss !== undefined && dismissOnBackdrop
          ? (event) => {
              if (event.target === event.currentTarget) onDismiss();
            }
          : undefined
      }
    >
      {children}
    </div>,
    document.body
  );
}
