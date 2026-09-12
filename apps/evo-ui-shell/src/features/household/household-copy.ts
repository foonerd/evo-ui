// Operator-facing copy helpers for household protection. The four level
// words are fixed (frozen wire); an unknown catalog level falls back to its
// id. Group marks are catalog-driven, so there is no per-group i18n key - we
// only lightly case the wire's own id (admin -> Admin, network_admin ->
// Network admin), never inventing policy copy.

import { t } from "../../runtime/i18n";

export function levelWord(id: string): string {
  switch (id) {
    case "open":
      return t("household.level.open");
    case "low":
      return t("household.level.low");
    case "standard":
      return t("household.level.standard");
    case "strict":
      return t("household.level.strict");
    default:
      return id;
  }
}

export function groupWord(id: string): string {
  const spaced = id.replace(/_/g, " ");
  return spaced.length === 0
    ? id
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
