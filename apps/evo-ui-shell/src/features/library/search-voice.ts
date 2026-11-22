// search-voice - the search mic's verb dispatcher.
//
// The mic beside the library search field runs the browser speech
// recognition this shell already has (runtime/input/voice.ts) with its
// default grammar, and dispatches into this: a "search ..." utterance
// runs the one search, once, through the surface's submitSearch; every
// other verb - play, pause, next, previous, stop, volume - is refused
// here, so this mic adds no voice plane anywhere else and sends nothing
// to the steward. No wire of its own.

import type { DispatchResult, Modality, Verb, VerbDispatcher } from "../../runtime/input/dispatcher";

export function searchVoiceDispatcher(onSearch: (query: string) => void): VerbDispatcher {
  return {
    dispatch(verb: Verb, _modality: Modality): Promise<DispatchResult> {
      if (verb.kind !== "search") {
        return Promise.resolve({
          ok: false,
          error: { code: "not_a_search", message: "this mic only searches the library" }
        });
      }
      const query = verb.query.trim();
      if (query.length === 0) {
        return Promise.resolve({
          ok: false,
          error: { code: "empty_search", message: "nothing to search for" }
        });
      }
      onSearch(query);
      return Promise.resolve({ ok: true });
    }
  };
}
