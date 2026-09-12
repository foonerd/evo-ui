// HouseholdSettingsRow - the Settings > System door into the household
// modal. It sits next to the pairing row but is a DIFFERENT concern: pairing
// is the connected-systems / headless door; this governs how locked-down the
// player is. It opens the ONE household modal - never Pair.
//
// Hidden when there is no household context (designer / no transport) so
// there is never a dead affordance.

import type { JSX } from "preact";
import { useHouseholdModal } from "./HouseholdModalHost";
import { levelWord } from "./household-copy";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function HouseholdSettingsRow(): JSX.Element | null {
  useLocale();
  const ctx = useHouseholdModal();
  if (ctx === null || !ctx.household.ready) return null;
  const snap = ctx.household.snapshot;
  return (
    <div className="settings-row">
      <span className="settings-label-text">{t("household.door.label")}</span>
      <button
        type="button"
        className="settings-link-button"
        onClick={ctx.open}
      >
        {t("household.door.manage")}
      </button>
      <p className="feature-description settings-help">
        {ctx.lent
          ? t("household.door.lent")
          : snap !== null
            ? t("household.door.current", { level: levelWord(snap.level) })
            : t("household.loading")}
      </p>
    </div>
  );
}
