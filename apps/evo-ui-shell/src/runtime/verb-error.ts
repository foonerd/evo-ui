// verb-error - shared extraction of an operator-facing message from
// a framework verb refusal. Previously copy-pasted per hook (queue,
// favourites, playlists, ...) with drifting fallbacks; one
// implementation, contract-tested, per plan law L4's "one data
// layer" spirit.
//
// Precedence: string error as-is > error.message > "Framework
// refused: <subclass>" > caller's fallback. The subclass branch is
// what renders refusal subclasses (position_out_of_range,
// payload_version_unsupported, ...) inline when the plugin sends no
// prose message.

import { t } from "./i18n.ts";

export function verbErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const message = rec["message"];
    if (typeof message === "string" && message.length > 0) return message;
    const subclass = rec["subclass"];
    if (typeof subclass === "string" && subclass.length > 0) {
      return t("collection.frameworkRefused", { subclass });
    }
  }
  return fallback;
}
