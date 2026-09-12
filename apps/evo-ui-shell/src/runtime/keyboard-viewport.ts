// Keep the focused input visible when an on-screen keyboard covers it.
//
// On the kiosk (WPE WebKit) and any touch client the OSK overlays the
// bottom of the screen. Nothing in the app knew it was there, so a field
// low in a form (Balbuze: Sources > Edit share > Advanced, vers=3.0) sat
// behind the keyboard, untypable. This is the ONE global guard: it binds
// at the document level, not per-surface, so every form benefits - share
// add/edit, Wi-Fi join, Pair, StepUp, prompts.
//
// It does two things, both keyed off window.visualViewport (the standard
// signal - when the OSK opens the visible viewport shrinks):
//   1. publishes the keyboard inset as the CSS var --keyboard-inset, so
//      centered overlays can lift above the keyboard (and tall cards can
//      cap their height and scroll);
//   2. scrolls the focused editable into the visible band.
//
// No visualViewport (SSR / tests / an engine without it) -> no-op, so a
// form that has no keyboard is never touched.

const KEYBOARD_INSET_VAR = "--keyboard-inset";
// Below this an inset is treated as zero - browser-chrome / rounding
// jitter of a few px is not a keyboard.
const KEYBOARD_MIN_PX = 80;
// Clearance kept between the focused field and the top of the keyboard.
const REVEAL_MARGIN_PX = 12;

/** Keyboard inset in px: the layout height not covered by the visible
 *  (visual) viewport. Insets below KEYBOARD_MIN_PX are treated as zero.
 *  Pure - unit-tested. */
export function keyboardInset(
  layoutViewportHeight: number,
  visualHeight: number,
  visualOffsetTop: number
): number {
  const inset = layoutViewportHeight - visualHeight - visualOffsetTop;
  return inset > KEYBOARD_MIN_PX ? Math.round(inset) : 0;
}

/** How far to scroll (px, positive = down) to bring [rectTop, rectBottom]
 *  fully inside [visibleTop, visibleBottom] with a margin. 0 when it is
 *  already inside (e.g. no keyboard). Pure - unit-tested. */
export function revealScrollDelta(
  rectTop: number,
  rectBottom: number,
  visibleTop: number,
  visibleBottom: number,
  margin: number = REVEAL_MARGIN_PX
): number {
  if (rectBottom > visibleBottom - margin) {
    return Math.ceil(rectBottom - (visibleBottom - margin));
  }
  if (rectTop < visibleTop + margin) {
    return -Math.ceil(visibleTop + margin - rectTop);
  }
  return 0;
}

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

/** Install the global keyboard-viewport guard. Returns an uninstall fn.
 *  No-op (returns a noop uninstall) when there is no window /
 *  visualViewport, so callers can install unconditionally. */
export function installKeyboardViewportGuard(): () => void {
  if (typeof window === "undefined" || window.visualViewport == null) {
    return () => undefined;
  }
  const vv = window.visualViewport;
  const rootStyle = document.documentElement.style;
  let raf = 0;

  const currentInset = (): number =>
    keyboardInset(window.innerHeight, vv.height, vv.offsetTop);

  const publishInset = (): void => {
    rootStyle.setProperty(KEYBOARD_INSET_VAR, `${currentInset()}px`);
  };

  const revealFocused = (): void => {
    const el = document.activeElement;
    if (!isEditable(el)) return;
    const inset = currentInset();
    if (inset === 0) return; // no keyboard: leave the form untouched.
    // getBoundingClientRect is layout-viewport-relative; the keyboard
    // covers the bottom `inset` px of it.
    const rect = el.getBoundingClientRect();
    const delta = revealScrollDelta(rect.top, rect.bottom, 0, window.innerHeight - inset);
    if (delta === 0) return;
    // scrollIntoView reveals the field inside whatever scrolls it - the
    // overlay card's own scroller or the window - and block:center keeps
    // it clear of the keyboard.
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const schedule = (): void => {
    if (raf !== 0) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      publishInset();
      revealFocused();
    });
  };

  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  document.addEventListener("focusin", schedule);
  // Publish an initial value so the CSS var is always defined.
  publishInset();

  return () => {
    if (raf !== 0) window.cancelAnimationFrame(raf);
    vv.removeEventListener("resize", schedule);
    vv.removeEventListener("scroll", schedule);
    document.removeEventListener("focusin", schedule);
    rootStyle.removeProperty(KEYBOARD_INSET_VAR);
  };
}
