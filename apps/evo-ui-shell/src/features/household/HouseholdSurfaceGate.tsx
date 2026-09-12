// HouseholdSurfaceGate - THE settings entry for a protested group.
//
// On access, not after a click: if the household snapshot marks this
// group protected and this sitting has no override token, the working
// surface does not mount. The operator sees two doors - change the
// household, or override with the system password. Next step is the
// existing HouseholdModal or the existing StepUpHost. Unlocked means
// unlocked: children render with no banner and no 403 paint.
//
// Enrollment: wrap a settings destination with the catalog group id.
// A new surface later is that wrap plus a row on the audio table.
// Playback is not a group. Security (the household door) is not wrapped
// as a protested group - household_protection_set is how they leave.

import type { ComponentChildren, JSX } from "preact";
import { Lock } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { useHouseholdModal } from "./HouseholdModalHost";
import { surfaceEntryLocked } from "./household-protection";
import { useStepUpSitting } from "./useStepUpSitting";

export function HouseholdSurfaceGate({
  group,
  children
}: {
  group: string;
  children: ComponentChildren;
}): JSX.Element {
  useLocale();
  const ctx = useHouseholdModal();
  const sitting = useStepUpSitting();

  if (ctx === null) {
    return <>{children}</>;
  }
  if (ctx.household.ready && ctx.household.snapshot === null) {
    return (
      <div className="household-gate" role="status">
        {t("household.loading")}
      </div>
    );
  }
  if (!surfaceEntryLocked(ctx.household.snapshot, group, sitting.live)) {
    return <>{children}</>;
  }

  return (
    <div className="household-gate" role="dialog" aria-label={t("household.gate.title")}>
      <div className="household-gate-card">
        <p className="household-gate-body">
          <Lock size={16} aria-hidden />
          {t("household.gate.body")}
        </p>
        <div className="household-gate-doors">
          <button
            type="button"
            className="settings-link-button"
            onClick={ctx.open}
          >
            {t("household.gate.change")}
          </button>
          <button
            type="button"
            className="settings-link-button"
            onClick={() => void sitting.request()}
          >
            {t("household.gate.override")}
          </button>
        </div>
      </div>
    </div>
  );
}
