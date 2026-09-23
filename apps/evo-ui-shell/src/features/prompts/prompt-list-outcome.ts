// prompt-list-outcome - what a list_user_interactions answer does to the
// prompts this holder already has.
//
// The seat holder seeds and re-seeds its open-prompt list from the
// framework. A list that FAILS (refused, socket gone, unreadable) used
// to be dropped on the floor: nothing recorded, nothing painted, and a
// holder could sit on an empty card while a prompt was live on the
// player. Now:
//
//   ok, decoded  -> the list IS the prompts; the failure, if any, clears
//   error        -> keep every prompt that already landed; record why
//   decode miss  -> same: landed prompts stay, the miss is recorded
//
// Nothing here clears a landed prompt on a failure. Pure, so the
// contract harness drives every branch.

import type { PromptItem } from "./prompt-decoders.ts";

export interface PromptListState {
  prompts: PromptItem[];
  /** Why the last list did not land; null while in flight or once one
   *  has. */
  listError: string | null;
}

/** The transport's result shape: an error, or a value. */
export interface PromptListWire {
  readonly error?: { readonly code: string; readonly message?: string };
  readonly value?: unknown;
}

export function applyPromptList(
  prev: PromptItem[],
  result: PromptListWire,
  decode: (raw: unknown) => PromptItem[] | null,
  unrecognised: () => string
): PromptListState {
  if (result.error !== undefined) {
    const message =
      typeof result.error.message === "string" && result.error.message.length > 0
        ? result.error.message
        : result.error.code;
    return { prompts: prev, listError: message };
  }
  const decoded = decode(result.value);
  if (decoded === null) {
    return { prompts: prev, listError: unrecognised() };
  }
  return { prompts: decoded, listError: null };
}

/** A prompt this holder answered or cancelled leaves the list. A
 *  recorded list failure means "a request may be waiting" - once the
 *  landed list is EMPTY that record is stale (the last thing waiting was
 *  just finished) and is cleared; while prompts remain it stays, so a
 *  later empty paint is still honest. Functional: apply through the
 *  state updater so two in-flight finishes never restore a neighbour. */
export function finishPrompt(
  prev: PromptListState,
  item: { plugin: string; promptId: string }
): PromptListState {
  const prompts = prev.prompts.filter(
    (p) => !(p.plugin === item.plugin && p.promptId === item.promptId)
  );
  return {
    prompts,
    listError: prompts.length === 0 ? null : prev.listError
  };
}
