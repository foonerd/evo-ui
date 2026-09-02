// Preact binding for the i18n runtime: components that render
// translated strings call useLocale() so a locale switch re-renders
// them. Kept separate from runtime/i18n.ts so the contract suite
// imports the pure module without preact.

import { useEffect, useState } from "preact/hooks";
import { activeLocale, onLocaleChange, type LocaleId } from "./i18n";

export function useLocale(): LocaleId {
  const [locale, setLocaleState] = useState<LocaleId>(activeLocale());
  useEffect(() => onLocaleChange(() => setLocaleState(activeLocale())), []);
  return locale;
}
