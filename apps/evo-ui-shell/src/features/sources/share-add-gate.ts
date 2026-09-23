// Start gate for adding / editing a network share.
//
// A user+password Add types the secret on the same dialog (Windows /
// Volumio). Submit starts when the form is valid. The fail-closed
// seat gate (a credentialed add closed unless this session held the
// responder seat) stays lifted: on a screen without the seat it
// greyed Add and no NAS share could be added at all.
//
// This is not a Pair ceremony and not the retired network_admin
// pre-flight. Pure, so the contract harness drives every branch. The
// pin (sources-add-gate.test.ts) is held by the Engineering Authority.

export type ShareCredKind = "guest" | "user_password";

/** Add does not raise a prompt card. The secret is on the form. */
export function addNeedsResponder(_credKind: ShareCredKind): boolean {
  return false;
}

/** May the add/edit submit start? Valid form only. */
export function canStartShareAdd(input: {
  valid: boolean;
  credKind: ShareCredKind;
}): boolean {
  return input.valid;
}
