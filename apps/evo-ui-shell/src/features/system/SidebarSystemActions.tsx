// SidebarSystemActions - the device-power cluster pinned to the
// bottom of the sidebar nav.
//
// Power off and Reboot are real verbs (system.power shelf); each
// opens a confirmation modal, then dispatches through useSystemPower.
// They are shown only when the system.power plugin is admitted, and
// the whole cluster's presence is operator data (nav.power - the
// caller gates rendering). Alarms and Update are ordinary curatable
// views in the System menu group, not part of this cluster.

import { Plane, Power, RotateCcw } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  useSystemPowerConfirm,
  SystemPowerConfirmModal
} from "./SystemPowerConfirm";

export function SidebarSystemActions() {
  useLocale();
  const power = useSystemPowerConfirm();
  const { setConfirm } = power;

  if (!power.available && !power.flightAvailable) {
    return null;
  }

  return (
    <div className="sidebar-system-actions">
      {power.available ? (
        <button
          type="button"
          className="sidebar-system-action"
          title={t("app.reboot")}
          aria-label={t("app.rebootAria")}
          onClick={() => setConfirm("reboot")}
        >
          <RotateCcw size={16} />
        </button>
      ) : null}
      {power.available ? (
        <button
          type="button"
          className="sidebar-system-action"
          title={t("app.powerOff")}
          aria-label={t("app.powerOffAria")}
          onClick={() => setConfirm("power_off")}
        >
          <Power size={16} />
        </button>
      ) : null}
      {power.flightAvailable ? (
        <button
          type="button"
          className={
            "sidebar-system-action" +
            (power.flightEnabled ? " sidebar-system-action-on" : "")
          }
          title={t("app.flightMode")}
          aria-label={
            power.flightEnabled
              ? t("app.flightModeOnAria")
              : t("app.flightModeOffAria")
          }
          aria-pressed={power.flightEnabled}
          onClick={() =>
            setConfirm(power.flightEnabled ? "flight_off" : "flight_on")
          }
        >
          <Plane size={16} />
        </button>
      ) : null}

      <SystemPowerConfirmModal
        confirm={power.confirm}
        busy={power.busy}
        accepted={power.accepted}
        error={power.error}
        onCancel={power.closeConfirm}
        onConfirm={() => void power.onConfirmAction()}
      />
    </div>
  );
}
