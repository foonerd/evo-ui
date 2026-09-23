// UsbRemovalHeartbeat - large working heartbeat for operator USB Remove.
//
// Stages come from storage_usb_drives.removal as the backend does the
// work (see usb-removal-paint.ts for what is painted for what). This
// panel does not walk a timer and never claims a stage the subject has
// not named. The parent unmounts it before showing the forced "USB
// device is safe to remove." modal, whose gate is the parent's.

import type { JSX } from "preact";
import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import { Modal } from "../../components/dialogs";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import {
  USB_REMOVAL_STAGE_ORDER,
  type UsbRemovalStage
} from "./usb-drives-decoders";
import {
  usbRemovalHeadlineKey,
  usbRemovalStageKey,
  usbRemovalStageState
} from "./usb-removal-paint";

export function UsbRemovalHeartbeat(props: {
  visible: boolean;
  stage: UsbRemovalStage | null;
}): JSX.Element | null {
  useLocale();
  if (!props.visible) return null;
  return (
    <HeartbeatPanel
      visible
      scrim
      mode="working"
      headline={t(usbRemovalHeadlineKey(props.stage))}
      sublabel={
        <ol className="usb-removal-stages">
          {USB_REMOVAL_STAGE_ORDER.map((s) => (
            <li
              key={s}
              className={`usb-removal-stage usb-removal-stage-${usbRemovalStageState(s, props.stage)}`}
            >
              {t(usbRemovalStageKey(s))}
            </li>
          ))}
        </ol>
      }
    />
  );
}

/** Forced ack: the Remove succeeded and the source is gone. */
export function UsbSafeToRemoveModal(props: {
  onAck: () => void;
}): JSX.Element {
  useLocale();
  return (
    <Modal title={t("library.usbSafeToRemove")} dismissible={false}>
      <div className="evo-modal-actions">
        <button
          type="button"
          className="evo-modal-button evo-modal-button-primary"
          onClick={props.onAck}
          autoFocus
        >
          {t("dialog.ok")}
        </button>
      </div>
    </Modal>
  );
}
