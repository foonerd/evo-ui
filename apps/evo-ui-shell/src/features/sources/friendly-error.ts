// friendlyVerbError - turn a raw device/plugin error chain into one
// plain-language sentence the operator can actually understand. The
// user is not technical: a raw string like "plugin error: permanent
// error: transient error: verb execution failed: smb.conf install
// failed: Permission denied (os error 13)" must NEVER reach the glass.
// The raw text is logged to the console for debugging (never on-screen).

import { t } from "../../runtime/i18n";

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
