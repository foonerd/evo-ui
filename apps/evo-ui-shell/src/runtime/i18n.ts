// i18n runtime - locale registry, active-locale state, and t().
// RELEASE GATE (ruled 2026-07-14): translations in the UI
// everywhere. This module is deliberately preact-free so the
// contract suite exercises it directly; components re-render via
// the useLocale() hook (runtime/use-locale.ts).
//
// Resolution: active catalog -> English -> the key itself (a visible
// wrong-but-readable failure, never a blank). The locale follows the
// ui.locale settings key, fanned out through applyUiSettings exactly
// like ui.theme - so changing language propagates live to every
// running session through the existing settings stream.

import { en, type MessageKey } from "../locales/en.ts";

export const UI_LOCALE_SETTINGS_KEY = "ui.locale";

/** Registered catalogs. Grows as target languages are named; every
 *  catalog must carry the full en key set (contract-tested). */
export const LOCALES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en,
};

export type LocaleId = keyof typeof LOCALES & string;

export function isLocaleId(v: unknown): v is LocaleId {
  return typeof v === "string" && v in LOCALES;
}

let active: LocaleId = "en";
const LOCALE_EVENT = "evo:locale-changed";

export function activeLocale(): LocaleId {
  return active;
}

/** Switch language: catalog, document lang, subscriber fan-out. */
export function setLocale(locale: LocaleId): void {
  if (locale === active) return;
  active = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCALE_EVENT));
  }
}

/** Subscribe to locale switches. Returns an unsubscribe. */
export function onLocaleChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LOCALE_EVENT, cb);
  return () => window.removeEventListener(LOCALE_EVENT, cb);
}

/** Translate. {param} placeholders interpolate from `params`;
 *  unknown placeholders stay literal (visible, debuggable). */
export function t(
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>
): string {
  const msg = LOCALES[active][key] ?? en[key] ?? key;
  if (params === undefined) return msg;
  return msg.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}

/** Pluralised translate - REQUIRED for the Slavic locales in the
 *  EU/EEU-first target set (ruled 2026-07-14): Polish/Russian/etc.
 *  need one/few/many forms, not just singular/plural.
 *
 *  The catalog stores one entry per CLDR plural category the
 *  language uses, suffixed on the base key:
 *    "queue.tracks.one":  "{n} track"
 *    "queue.tracks.many": "{n} tracks"        (en uses one/other;
 *    "queue.tracks.few":  "{n} utwory"         pl adds few/many)
 *  Category comes from Intl.PluralRules for the ACTIVE locale;
 *  fallback chain: exact category -> other -> many -> one, so a
 *  catalog missing a rare category still renders. {n} interpolates
 *  automatically; extra params pass through. */
export function tn(
  baseKey: string,
  n: number,
  params?: Readonly<Record<string, string | number>>
): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(active).select(n);
  } catch {
    // Unknown locale tag in the runtime - fall through to "other".
  }
  const table = LOCALES[active];
  const pick = (cat: string): string | undefined =>
    table[`${baseKey}.${cat}`] ?? (en as Record<string, string>)[`${baseKey}.${cat}`];
  const msg =
    pick(category) ?? pick("other") ?? pick("many") ?? pick("one") ?? `${baseKey}.${category}`;
  return msg.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === "n") return String(n);
    return params !== undefined && name in params ? String(params[name]) : whole;
  });
}
