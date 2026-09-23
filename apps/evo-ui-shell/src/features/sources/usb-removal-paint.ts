// usb-removal-paint - what the USB Remove heartbeat says for what the
// subject has named so far.
//
// storage_usb_drives.removal names a stage as the plugin starts it:
// queue (the stick's tracks leave the queue), detach, eject, retract,
// then safe. The heartbeat paints exactly that
// and nothing ahead of it: before the first frame the headline is the
// neutral working line with every stage pending; a work stage is the
// current one with the earlier ones done; "safe" is every stage done
// with the headline left on the last work stage, because the final
// word - "USB device is safe to remove." - is the modal's, and the
// modal has its own gate. Pure; the contract harness drives every
// branch.

import { USB_REMOVAL_STAGE_ORDER, type UsbRemovalStage } from "./usb-drives-decoders.ts";
import type { MessageKey } from "../../locales/en.ts";

export type UsbRemovalWorkStage = Exclude<UsbRemovalStage, "safe">;

export function usbRemovalStageKey(stage: UsbRemovalWorkStage): MessageKey {
  switch (stage) {
    case "queue":
      return "library.usbRemoveStageQueue";
    case "detach":
      return "library.usbRemoveStageDetach";
    case "eject":
      return "library.usbRemoveStageEject";
    case "retract":
      return "library.usbRemoveStageRetract";
  }
}

/** The headline for the last stage the subject named: null (none yet)
 *  -> the neutral working line; a work stage -> that stage; "safe" ->
 *  the last work stage. Never the modal's line. */
export function usbRemovalHeadlineKey(stage: UsbRemovalStage | null): MessageKey {
  if (stage === null) return "library.usbRemoveWorking";
  if (stage === "safe") return "library.usbRemoveStageRetract";
  return usbRemovalStageKey(stage);
}

/** done / current / pending for one listed stage, given the last stage
 *  the subject named (null = none yet; "safe" = all done). */
export function usbRemovalStageState(
  stage: UsbRemovalWorkStage,
  current: UsbRemovalStage | null
): "done" | "current" | "pending" {
  if (current === null) return "pending";
  if (current === "safe") return "done";
  const si = USB_REMOVAL_STAGE_ORDER.indexOf(stage);
  const ci = USB_REMOVAL_STAGE_ORDER.indexOf(current);
  if (si < ci) return "done";
  if (si === ci) return "current";
  return "pending";
}
