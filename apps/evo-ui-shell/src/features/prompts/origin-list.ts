// origin-list - what a list_user_interactions refusal means to a session
// that does not hold the responder seat.
//
// The framework answers the list two ways. The seat holder sees every
// open prompt. A connection with no seat sees the prompts its own
// dispatches raised (the origin door: the operator whose Add share
// raised the password card can answer it here, without the seat), and
// when none of its own are open it is refused
// user_interaction_responder_not_granted - the same refusal as before,
// so an operator with no standing is never handed an empty success.
//
// For a session without the seat that refusal is SILENCE: nothing of
// ours is open. It is not "no prompts pending" on the device (the seat
// may hold some) and it is not a failed list to paint a retry for. The
// seat holder keeps the failure semantics of prompt-list-outcome
// unchanged. Pure; the contract harness drives every branch.

export const RESPONDER_NOT_GRANTED = "user_interaction_responder_not_granted";

export interface OriginListWire {
  readonly error?: {
    readonly code: string;
    readonly message?: string;
    readonly subclass?: string;
  };
  readonly value?: unknown;
}

/** True when this session holds no seat and the list was refused for
 *  exactly that reason: the origin has nothing open. Paint nothing,
 *  record nothing. Any other answer goes through applyPromptList. */
export function originListSilence(
  result: OriginListWire,
  seatHeld: boolean
): boolean {
  if (seatHeld) return false;
  return result.error !== undefined && result.error.subclass === RESPONDER_NOT_GRANTED;
}
