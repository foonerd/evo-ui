// Designer -> preview appearance channel. The browser designer
// (DisplayTestLab) and the embedded <App> live in sibling React
// subtrees, so the designer drives the preview's appearance through
// localStorage + a same-window event (the same pattern the now-playing
// title-overflow toggle uses). This is designer-only: it lets the
// operator pick/preview a theme without changing the device's applied
// ui.theme. When unset, the preview falls back to the device theme.

const THEME_KEY = "evo.designer.theme_override";
const EVENT = "evo:designer-appearance-changed";

/** The designer's theme override, or null to follow the device theme. */
export function readDesignerTheme(): string | null {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v !== null && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeDesignerTheme(themeId: string): void {
  try {
    window.localStorage.setItem(THEME_KEY, themeId);
  } catch {
    // Non-fatal: the override just does not persist this session.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** Subscribe to designer appearance changes (same-window event +
 *  cross-tab storage event). Returns an unsubscribe. */
export function onDesignerAppearanceChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
