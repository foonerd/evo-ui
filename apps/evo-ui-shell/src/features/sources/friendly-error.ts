// friendlyVerbError - turn a raw device/plugin error chain into one
// plain-language sentence the operator can actually understand. The
// user is not technical: a raw string like "plugin error: permanent
// error: transient error: verb execution failed: smb.conf install
// failed: Permission denied (os error 13)" must NEVER reach the glass.
// The raw text is logged to the console for debugging (never on-screen).

import { t } from "../../runtime/i18n.ts";
import { isShareBusyReason } from "./share-busy.ts";
import { isSharePasswordMissing } from "./share-password-needed.ts";

/** The Sources sentence for a verb refusal. One case is Sources' own:
 *  a mount refused because the share's vault has no password is not
 *  a device fault - the operator types the password on Edit, then
 *  presses Connect - and the shared mapper's sentence for that string
 *  belongs to File-sharing user-add. Everything else defers to
 *  friendlyVerbError. Sources paints through this and nothing else. */
export function friendlyShareError(raw: string | undefined): string {
  if (isSharePasswordMissing(raw)) {
    if (raw !== undefined && raw.length > 0 && typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[verb error]", raw);
    }
    return t("sources.err.passwordNeeded");
  }
  return friendlyVerbError(raw);
}

export function friendlyVerbError(raw: string | undefined): string {
  // Keep the real chain available for debugging - console only.
  if (raw !== undefined && raw.length > 0 && typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.error("[verb error]", raw);
  }
  const m = (raw ?? "").toLowerCase();
  if (/reserved|not allowed|blocklist|blocked/.test(m)) {
    return t("err.reservedName");
  }
  if (/already exists|user.*exists/.test(m)) {
    return t("err.userExists");
  }
  if (/credential vault has no entry|no entry for key|credential.*missing|no credential/.test(m)) {
    return t("err.credentialMissing");
  }
  // A share still in use: the plugin's MountError::Busy Display
  // ("target is busy", holders optional) or the kernel's own words.
  // One sentence; the holder list stays in share-busy and the
  // console. Sits above the permission branch: a busy line that
  // names a path must never read as a device-permission fault.
  if (isShareBusyReason(raw)) {
    return t("err.shareBusy");
  }
  // Share auth / export refusal rides the plugin's
  // AuthenticationRefused Display and the helper tokens that
  // only travel with it. Must sit above the generic permission
  // branch: those strings also contain "permission denied" /
  // "os error 13", and err.permission blames this device.
  if (
    /authentication refused|mount error\(13\)|nt_status_logon_failure|nt_status_access_denied|access denied by server/.test(
      m
    )
  ) {
    return t("err.shareAccessRefused");
  }
  if (/permission denied|os error 13|not permitted|eacces|\bdenied\b/.test(m)) {
    return t("err.permission");
  }
  if (/unreachable|could not connect|connection refused|timed ?out|no route|network is/.test(m)) {
    return t("err.unreachable");
  }
  if (/no plugin on shelf|no responder|unavailable|not available|admission|not admitted/.test(m)) {
    return t("err.unavailable");
  }
  if (/not found|enoent|no such|absent/.test(m)) {
    return t("err.notFound");
  }
  return t("err.generic");
}
