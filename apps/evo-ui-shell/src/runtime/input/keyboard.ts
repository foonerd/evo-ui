// Keyboard input modality. Maps W3C `KeyboardEvent.key` values
// onto the canonical verb vocabulary so every device with a
// keyboard (operator laptop, USB keyboard on a kiosk, Bluetooth
// keyboard on a phone) reaches the same dispatcher. Layered on
// the document so plugin-rendered widgets that take input focus
// (search box, prompt fields) can opt out by stopping the event
// at their own element.

import type { Verb, VerbDispatcher } from "./dispatcher";

/** One key binding. */
export interface KeyBinding {
  /** W3C `KeyboardEvent.key` value (e.g. " ", "ArrowLeft"). */
  readonly key: string;
  /** Optional modifier (ctrl / alt / meta / shift). `none` = no modifier required. */
  readonly modifier: "none" | "ctrl" | "alt" | "meta" | "shift";
  /** Verb to dispatch. */
  readonly verb: Verb;
  /** Optional human-readable hint for the operator (rendered in the help surface). */
  readonly label?: string;
}

/** The framework default key bindings — playback transport + navigation. */
export const DEFAULT_KEY_BINDINGS: readonly KeyBinding[] = Object.freeze([
  {
    key: " ",
    modifier: "none",
    verb: { kind: "toggle_play_pause" },
    label: "Toggle play / pause",
  },
  {
    key: "ArrowLeft",
    modifier: "none",
    verb: { kind: "seek_relative", seconds: -5 },
    label: "Rewind 5 s",
  },
  {
    key: "ArrowRight",
    modifier: "none",
    verb: { kind: "seek_relative", seconds: 5 },
    label: "Fast-forward 5 s",
  },
  {
    key: "ArrowUp",
    modifier: "none",
    verb: { kind: "volume_relative", delta: 0.05 },
    label: "Volume up",
  },
  {
    key: "ArrowDown",
    modifier: "none",
    verb: { kind: "volume_relative", delta: -0.05 },
    label: "Volume down",
  },
  {
    key: "n",
    modifier: "none",
    verb: { kind: "next" },
    label: "Next track",
  },
  {
    key: "p",
    modifier: "none",
    verb: { kind: "previous" },
    label: "Previous track",
  },
  {
    key: "s",
    modifier: "none",
    verb: { kind: "stop" },
    label: "Stop playback",
  },
]);

/**
 * Mount keyboard bindings on the document. Returns a teardown
 * closure the runtime calls on shutdown.
 *
 * Behaviour: every keydown that matches a binding is dispatched
 * unless the event's target is a text input, textarea, or
 * contenteditable surface (the operator is typing — the
 * keystroke is meant for the field, not the verb dispatcher).
 */
export function mountKeyboardBindings(
  dispatcher: VerbDispatcher,
  bindings: readonly KeyBinding[] = DEFAULT_KEY_BINDINGS,
): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = (event: KeyboardEvent): void => {
    if (isTextInputTarget(event.target)) return;
    const match = bindings.find(
      (b) => b.key === event.key && modifierMatches(event, b.modifier),
    );
    if (match === undefined) return;
    event.preventDefault();
    void dispatcher.dispatch(match.verb, "keyboard");
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}

function modifierMatches(
  event: KeyboardEvent,
  modifier: KeyBinding["modifier"],
): boolean {
  switch (modifier) {
    case "none":
      return !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    case "ctrl":
      return event.ctrlKey;
    case "alt":
      return event.altKey;
    case "meta":
      return event.metaKey;
    case "shift":
      return event.shiftKey;
  }
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
