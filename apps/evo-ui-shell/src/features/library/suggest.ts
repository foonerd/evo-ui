// suggest - the library.suggest envelope and the decoder for its answer.
//
// Suggestions while the operator is still typing. The payload is the
// prefix and nothing else; the hook adds the envelope version. The
// answer is a list of strings in the plugin's order (artists, albums,
// titles; at most eight; deduplicated there) and the glass shows it as
// it came. This is not the search: the submitted search stays
// library.search_library.

export type SuggestPayload = {
  prefix: string;
};

export function suggestPayload(prefix: string): SuggestPayload {
  return { prefix };
}

/** How long typing must pause before the one suggest request goes out.
 *  A keystroke inside this window replaces the pending prefix. */
export const SUGGEST_PAUSE_MS = 300;

/** Decode the suggest answer, or null when it carries no list. Non-string
 *  and empty rows are dropped; the order and any repeats are the
 *  plugin's. */
export function decodeSuggestions(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const list = (raw as Record<string, unknown>)["suggestions"];
  if (!Array.isArray(list)) return null;
  return list.filter((v): v is string => typeof v === "string" && v.length > 0);
}
