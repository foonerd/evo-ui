// Start gate for adding / editing a network share.
//
// A user+password share stocks its secret through the framework prompt
// (PromptSurface) on whoever holds user_interaction_responder — usually
// the player, not this browser. Submit starts when the form is valid;
// the plugin raises the password card on the responder. This session
// shows the notice so the operator looks at the player. Guest still
// has no prompt.
//
// This is not a Pair ceremony and not the retired network_admin
// pre-flight. Pure, so the contract harness drives every branch.

export type ShareCredKind = "guest" | "user_password";

/** A credentialed (user+password) add/edit raises the password prompt; a
 *  guest one does not. */
export function addNeedsResponder(credKind: ShareCredKind): boolean {
  return credKind === "user_password";
}

/** May the add/edit submit start? Valid form only. The responder lock
 *  is not a submit gate — it only chooses where the password is painted. */
export function canStartShareAdd(input: {
  valid: boolean;
  credKind: ShareCredKind;
  responderGranted: boolean;
}): boolean {
  return input.valid;
}

/** Show the "password is asked on the player" line: only for a
 *  credentialed share on a session that cannot paint the prompt. Never a
 *  Pair prompt — a responder miss is not a pairing ceremony. */
export function showCredentialResponderNotice(input: {
  credKind: ShareCredKind;
  responderGranted: boolean;
}): boolean {
  return addNeedsResponder(input.credKind) && !input.responderGranted;
}
