// language - language.set on shelf system.locale, its payload, and the
// decoder for its answer.
//
// The operator's language, set from Settings at any time after first boot.
// The glass ships one catalogue, so the only language offered is en: a tag
// other than en is never sent. The answer { v: 1, language } names the
// language now in force; that, and only that, is the language the glass
// shows. This is not the ui.locale setting the first-boot path follows.

export const LOCALE_SHELF = "system.locale";

export const LANGUAGE_VERB = "language.set";

/** The languages the glass offers: the catalogues it ships. */
export const OFFERED_LANGUAGES = ["en"] as const;

export type LanguagePayload = { v: 1; language: string };

/** The payload, or null when the tag is not an offered language - nothing
 *  is sent. */
export function languagePayload(tag: string): LanguagePayload | null {
  if (!(OFFERED_LANGUAGES as ReadonlyArray<string>).includes(tag)) return null;
  return { v: 1, language: tag };
}

/** The language the answer names, or null when it names none. */
export function decodeLanguageAnswer(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const language = (raw as Record<string, unknown>)["language"];
  return typeof language === "string" && language.length > 0 ? language : null;
}
