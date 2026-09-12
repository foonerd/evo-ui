// Fail-closed gate for adding / editing a network share.
//
// A user+password share stocks its secret through the framework's separate
// prompt (PromptSurface), which only THIS session can paint when it holds the
// user_interaction_responder role. If the session cannot paint the prompt, the
// mutation must NOT start: the framework would persist the share and hold the
// mutation for an answer this browser can never show, leaving a dead share
// listed "Not connected". So a credentialed add is gated on the responder.
//
// This is the responder lock ONLY - it is NOT the retired client-side
// network_admin pre-flight, and it is NOT a Pair ceremony (a responder miss is
// not pair_*). A GUEST share carries no secret, raises no prompt, and proceeds
// regardless. Pure, so the contract harness drives every branch.

export type ShareCredKind = "guest" | "user_password";

/** A credentialed (user+password) add/edit needs the prompt responder; a guest
 *  one does not. */
export function addNeedsResponder(credKind: ShareCredKind): boolean {
  return credKind === "user_password";
}

/** May the add/edit submit start? Fail-closed: a valid form is still blocked
 *  when it is credentialed and this session cannot paint the password prompt.
 *  Guest proceeds whenever the form is valid. */
export function canStartShareAdd(input: {
  valid: boolean;
  credKind: ShareCredKind;
  responderGranted: boolean;
}): boolean {
  const { valid, credKind, responderGranted } = input;
  if (!valid) return false;
  if (addNeedsResponder(credKind) && !responderGranted) return false;
  return true;
}

/** Show the honest "this screen cannot ask for the password" line: only for a
 *  credentialed share on a session that cannot paint the prompt. Never a Pair
 *  prompt - a responder miss is not a pairing ceremony. */
export function showCredentialResponderNotice(input: {
  credKind: ShareCredKind;
  responderGranted: boolean;
}): boolean {
  return addNeedsResponder(input.credKind) && !input.responderGranted;
}
