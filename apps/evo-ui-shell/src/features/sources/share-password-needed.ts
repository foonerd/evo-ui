// share-password-needed - the one place the glass reads a share
// refusal for "no password in the vault". Pure: no i18n, no DOM.
//
// The plugin refuses a mount on an empty vault with exactly
// "credential vault has no entry for key {key}" (MountError::
// CredentialMissing). It raises no card on this path. The operator's
// way forward is Edit (type the password, which the surface stocks)
// and then Connect. The key never leaves this module.

/** Whether a verb error or reason is the empty-vault refusal. */
export function isSharePasswordMissing(raw: string | null | undefined): boolean {
  const m = (raw ?? "").toLowerCase();
  return /credential vault has no entry for key/.test(m);
}
