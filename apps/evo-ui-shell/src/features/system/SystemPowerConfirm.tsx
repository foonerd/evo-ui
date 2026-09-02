// SystemPowerConfirm - the shared guarded-power state machine and
// confirmation modal, used by both the sidebar power cluster
// (SidebarSystemActions) and the pivot device reveal
// (PivotHome's device overlay).
//
// The power verbs (reboot_device / power_off_device on the
// system.power shelf) are real and step_up:system_admin gated. This
// module owns the confirm -> dispatch -> outcome flow and the
// post-reboot health-poll reconnect, so both call sites share one
// correct implementation rather than diverging copies. Each call
// site renders its own trigger buttons (their styling differs) and
// drives this hook's `setConfirm`, then renders
// <SystemPowerConfirmModal/> with the hook's state.

import { useEffect, useState } from "preact/hooks";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { StepUpConfirm } from "../../components/StepUpConfirm";
import { Power, RotateCcw } from "lucide-preact";
import { useSystemPower } from "./useSystemPower";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

/** Which power verb a confirmation is currently gating. */
export type SystemPowerConfirmKind = "reboot" | "power_off";

export interface SystemPowerConfirmState {
  /** True only when a system.power plugin is admitted - the gate the
   *  trigger buttons hide behind. */
  available: boolean;
  /** The verb currently being confirmed, or null when no modal. */
  confirm: SystemPowerConfirmKind | null;
  /** Open the confirmation modal for a verb. */
  setConfirm: (kind: SystemPowerConfirmKind | null) => void;
  /** A dispatch is in flight. */
  busy: boolean;
  /** The host accepted the verb and is shutting down / restarting. */
  accepted: boolean;
  /** Operator-facing refusal message, or null. */
  error: string | null;
  /** Dismiss the modal and reset its state. */
  closeConfirm: () => void;
  /** Dispatch the currently-confirmed verb. */
  onConfirmAction: () => Promise<void>;
}

/** Owns the guarded-power confirm flow. Calls useSystemPower once,
 *  so each component that uses this hook holds a single power probe. */
export function useSystemPowerConfirm(): SystemPowerConfirmState {
  const power = useSystemPower();
  const [confirm, setConfirm] = useState<SystemPowerConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After an accepted reboot the device drops off the network for
  // ~a minute. Poll the runtime health endpoint; once it answers the
  // device is back, so reload to re-seed every hook against the
  // restarted framework. This is what makes the modal's "reconnects
  // on its own" promise true. Power-off never comes back - no poll.
  useEffect(() => {
    if (!accepted || confirm !== "reboot") return undefined;
    let stopped = false;
    const poll = async (): Promise<void> => {
      while (!stopped) {
        await new Promise<void>((r) => setTimeout(r, 3000));
        if (stopped) return;
        try {
          const res = await fetch("/api/ui/v1/health", { cache: "no-store" });
          if (res.ok) {
            window.location.reload();
            return;
          }
        } catch {
          // Device still rebooting - keep polling.
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [accepted, confirm]);

  const closeConfirm = (): void => {
    setConfirm(null);
    setBusy(false);
    setAccepted(false);
    setError(null);
  };

  const onConfirmAction = async (): Promise<void> => {
    if (confirm === null) return;
    setError(null);
    setBusy(true);
    const outcome =
      confirm === "reboot" ? await power.reboot() : await power.powerOff();
    if (outcome.kind === "accepted") {
      // The host is shutting down. Hold the modal on the accepted
      // view; the page goes stale until the device is back.
      setAccepted(true);
      return;
    }
    setBusy(false);
    if (outcome.kind === "not_authorised") {
      setError(t("power.notAuthorised"));
    } else if (outcome.kind === "step_up_required") {
      setError(t("power.stepUpRequired"));
    } else {
      setError(outcome.message);
    }
  };

  return {
    available: power.available,
    confirm,
    setConfirm,
    busy,
    accepted,
    error,
    closeConfirm,
    onConfirmAction
  };
}

interface SystemPowerConfirmModalProps {
  confirm: SystemPowerConfirmKind | null;
  busy: boolean;
  accepted: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The confirmation modal. Renders nothing when `confirm` is null. */
export function SystemPowerConfirmModal({
  confirm,
  busy,
  accepted,
  error,
  onCancel,
  onConfirm
}: SystemPowerConfirmModalProps) {
  useLocale();
  if (confirm === null) return null;
  const isReboot = confirm === "reboot";
  // The ACCEPTED view (host is going down) is power-specific and
  // has no cancel path - it stays bespoke on the step-up band.
  if (accepted) {
    return (
      <AttentionOverlay
        band="stepup"
        className="sys-confirm-root"
        role="alertdialog"
        ariaLabel={isReboot ? t("app.rebootAria") : t("app.powerOffAria")}
      >
        <div className="sys-confirm-card">
          <span className="sys-confirm-ic" aria-hidden>
            {isReboot ? <RotateCcw size={22} /> : <Power size={22} />}
          </span>
          <h4>{isReboot ? t("power.restarting") : t("power.poweringOff")}</h4>
          <p>
            {isReboot
              ? t("power.rebootAcceptedBody")
              : t("power.powerOffAcceptedBody")}
          </p>
          {isReboot ? (
            <div className="sys-confirm-actions">
              <button
                type="button"
                className="sys-confirm-go"
                onClick={() => window.location.reload()}
              >
                <RotateCcw size={14} />
                <span>{t("power.reloadNow")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </AttentionOverlay>
    );
  }
  // The confirm view is the FIRST consumer of the generalised
  // StepUpConfirm (Phase 1c) - pixel-identical to the approved
  // power confirm.
  return (
    <StepUpConfirm
      icon={isReboot ? <RotateCcw size={22} /> : <Power size={22} />}
      danger={!isReboot}
      title={isReboot ? t("power.rebootTitle") : t("power.powerOffTitle")}
      body={isReboot ? t("power.rebootBody") : t("power.powerOffBody")}
      error={error}
      busy={busy}
      confirmLabel={
        busy ? t("power.working") : isReboot ? t("power.rebootNow") : t("app.powerOff")
      }
      confirmIcon={isReboot ? <RotateCcw size={14} /> : <Power size={14} />}
      ariaLabel={isReboot ? t("app.rebootAria") : t("app.powerOffAria")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
