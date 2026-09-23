// share-busy - the one place the glass reads a share refusal for
// "still in use". Pure: no i18n, no DOM.
//
// The plugin's MountError::Busy Display is "unmount refused for share
// <id>: target is busy", with "; held by <pid>:<comm>, ..." appended
// only when it could name a holder. The kernel's own words for the same
// refusal are "target is busy" (util-linux) and "Device or resource
// busy" (systemd). All of them are the same fact to the operator: the
// share is in use. Holders, ids and the subprocess line never leave
// this module; the surface asks yes / no and paints one sentence.

/** Whether a verb error or event detail is the busy refusal. Empty
 *  holders still match. */
export function isShareBusyReason(raw: string | null | undefined): boolean {
  const m = (raw ?? "").toLowerCase();
  return /target is busy|device or resource busy|device is busy/.test(m);
}

/** An Activity event that failed because the share was in use. The
 *  detail is read here, once, and never painted. */
export function isBusyEvent(ev: {
  kind: string;
  detail: string | null;
}): boolean {
  if (ev.kind !== "mount_failed" && ev.kind !== "unmount_failed") return false;
  return isShareBusyReason(ev.detail);
}
