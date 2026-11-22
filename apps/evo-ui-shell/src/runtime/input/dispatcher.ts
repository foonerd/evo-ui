// Multi-modal verb dispatcher. Voice, gesture, keyboard, touch,
// and IR-remote modalities all funnel through one typed surface
// so plugins declaring verbs get every modality for free — the
// classifier maps each modality's primitive event into a typed
// `Verb` value; the dispatcher routes the verb through the SDK.
//
// This is the multi-modal input convergence posture: the wire
// schema is the source of truth; every input modality is a
// projection onto the same verb vocabulary; widgets and plugins
// stay modality-agnostic.

import type { EvoClient } from "../../sdk/client";

/**
 * Canonical verb vocabulary the operator can invoke. The audio
 * reference device's playback warden honours each verb via the
 * framework's course-correct dispatcher; other reference
 * devices (and vendor distributions) extend this taxonomy as
 * their domain requires.
 */
export type Verb =
  | { readonly kind: "play" }
  | { readonly kind: "pause" }
  | { readonly kind: "toggle_play_pause" }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "seek_relative"; readonly seconds: number }
  | { readonly kind: "volume_relative"; readonly delta: number }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "play_now"; readonly uri: string }
  | { readonly kind: "stop" };

/** Active modality the dispatcher is currently honouring (for UI feedback). */
export type Modality = "keyboard" | "voice" | "gesture" | "touch" | "ir" | "ui";

/**
 * Result of a dispatch. Mirrors `WireOpResult`'s shape so consumers
 * can pattern-match without re-importing the SDK types.
 */
export interface DispatchResult {
  readonly ok: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

/** The multi-modal dispatcher contract. */
export interface VerbDispatcher {
  dispatch(verb: Verb, modality: Modality): Promise<DispatchResult>;
}

/**
 * Default dispatcher implementation: transport verbs route through
 * `client.plugins.courseCorrect` with the audio playback custody as
 * target; play_now routes the same way with its uri. Search is not a
 * steward command and is refused here - the library surface runs it.
 */
export class SdkVerbDispatcher implements VerbDispatcher {
  public constructor(private readonly client: EvoClient) {}

  public async dispatch(
    verb: Verb,
    modality: Modality,
  ): Promise<DispatchResult> {
    const payload = verbToPayload(verb);
    if (payload === null) return { ok: false, error: invalidVerb(verb) };
    const op = verbOp(verb);
    // Modality is recorded in the dispatch payload for audit
    // attribution so the lifecycle ledger can record what surface
    // the operator drove from. Wire-side handlers ignore the
    // field when unset; renderers may surface modality-specific
    // affordances downstream.
    payload.modality = modality;
    const result = await routeOp(this.client, op, payload);
    if (result.error !== undefined) {
      return {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
    }
    return { ok: true };
  }
}

type SdkRoute =
  | "course_correct"
  | "search"
  | "play_now";

function verbOp(verb: Verb): SdkRoute {
  switch (verb.kind) {
    case "search":
      return "search";
    case "play_now":
      return "play_now";
    default:
      return "course_correct";
  }
}

function verbToPayload(verb: Verb): Record<string, unknown> | null {
  switch (verb.kind) {
    case "play":
    case "pause":
    case "next":
    case "previous":
    case "stop":
      return { verb: verb.kind, target: "audio.playback" };
    case "toggle_play_pause":
      return { verb: "toggle_play_pause", target: "audio.playback" };
    case "seek_relative":
      return {
        verb: "seek_relative",
        target: "audio.playback",
        seconds: verb.seconds,
      };
    case "volume_relative":
      return {
        verb: "volume_relative",
        target: "audio.playback",
        delta: verb.delta,
      };
    case "search":
      return { query: verb.query };
    case "play_now":
      return { uri: verb.uri };
  }
}

async function routeOp(
  client: EvoClient,
  op: SdkRoute,
  payload: Record<string, unknown>,
): Promise<{ error?: { code: string; message: string } }> {
  switch (op) {
    case "course_correct":
      return await client.plugins.courseCorrect(payload);
    case "search":
      // A search utterance is not a steward command. The library
      // surface owns the search (library.search_library through its
      // one submit path, with its own voice dispatcher); this shared
      // dispatcher refuses it rather than send it anywhere.
      return {
        error: {
          code: "search_not_steward",
          message: "search is run on the library surface, not by the steward",
        },
      };
    case "play_now":
      return await client.plugins.courseCorrect({
        verb: "play_now",
        ...payload,
      });
  }
}

function invalidVerb(verb: Verb): { code: string; message: string } {
  return {
    code: "invalid_verb",
    message: `verb shape not dispatchable: ${JSON.stringify(verb)}`,
  };
}
