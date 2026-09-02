// Gesture / touch input modality. Pointer Events unify mouse,
// touch, and pen so one binding covers every device. The default
// grammar maps swipe-left → previous, swipe-right → next,
// double-tap → play/pause; consumers can extend or replace the
// detector.

import type { Verb, VerbDispatcher } from "./dispatcher";

/** Tunable thresholds for gesture classification. */
export interface GestureConfig {
  /** Minimum pointer-down → pointer-up distance for a swipe (px). */
  readonly swipeMinDistance: number;
  /** Maximum swipe duration (ms). Longer pointer holds are not swipes. */
  readonly swipeMaxDurationMs: number;
  /** Maximum interval between two taps for a double-tap (ms). */
  readonly doubleTapMaxIntervalMs: number;
  /** Maximum movement between two taps for a double-tap (px). */
  readonly doubleTapMaxDistance: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = Object.freeze({
  swipeMinDistance: 60,
  swipeMaxDurationMs: 600,
  doubleTapMaxIntervalMs: 350,
  doubleTapMaxDistance: 30,
});

/**
 * Mount Pointer Event handlers on the document. Returns a
 * teardown closure the runtime calls on shutdown.
 */
export function mountGestureBindings(
  dispatcher: VerbDispatcher,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): () => void {
  if (typeof document === "undefined") return () => {};

  type PointerState = {
    startX: number;
    startY: number;
    startMs: number;
  };
  const inflight = new Map<number, PointerState>();
  let lastTapX = 0;
  let lastTapY = 0;
  let lastTapAt = 0;

  const onDown = (event: PointerEvent): void => {
    if (event.target instanceof HTMLElement) {
      // Skip when the operator is interacting with an input
      // surface — the gesture dispatcher would interfere with
      // text selection / scroll / drag.
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    }
    inflight.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      startMs: performance.now(),
    });
  };

  const onUp = (event: PointerEvent): void => {
    const state = inflight.get(event.pointerId);
    if (state === undefined) return;
    inflight.delete(event.pointerId);
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const dt = performance.now() - state.startMs;
    const dist = Math.hypot(dx, dy);

    if (
      dist >= config.swipeMinDistance &&
      dt <= config.swipeMaxDurationMs &&
      Math.abs(dx) > Math.abs(dy)
    ) {
      // Horizontal swipe.
      const verb: Verb =
        dx > 0 ? { kind: "next" } : { kind: "previous" };
      void dispatcher.dispatch(verb, "gesture");
      return;
    }

    if (dist < config.doubleTapMaxDistance && dt < 250) {
      // Treat short, low-motion press as a tap. Classify
      // double-tap by comparing to the prior tap.
      const now = performance.now();
      if (
        now - lastTapAt <= config.doubleTapMaxIntervalMs &&
        Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) <=
          config.doubleTapMaxDistance
      ) {
        void dispatcher.dispatch({ kind: "toggle_play_pause" }, "touch");
        lastTapAt = 0;
        return;
      }
      lastTapAt = now;
      lastTapX = event.clientX;
      lastTapY = event.clientY;
    }
  };

  const onCancel = (event: PointerEvent): void => {
    inflight.delete(event.pointerId);
  };

  document.addEventListener("pointerdown", onDown);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  return () => {
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
  };
}
