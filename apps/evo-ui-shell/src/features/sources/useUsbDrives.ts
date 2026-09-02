// useUsbDrives - the device's own USB drives (storage.usb shelf).
//
// Read-then-subscribe on storage_usb_drives; the reactive envelope carries
// the FULL drive set on every republish (no diff-tracking on the consumer).
// The four mutating verbs (mount / safe_remove / repair_filesystem / rename)
// are step-up gated against storage_admin, so they ride the paired bearer
// exactly like the SMB-server + share-consumer mutations. A private bearer
// socket is kept (see useShelfSubject); reauth() rebuilds it after inline
// pairing without a page reload.

import { useCallback } from "preact/hooks";
import {
  useShelfSubject,
  type SubjectConnectionState
} from "../../runtime/use-shelf-subject";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { verbErrorMessage } from "../../runtime/verb-error";
import { storedBearer } from "../../runtime/bearer";
import { t } from "../../runtime/i18n";
import {
  decodeUsbDrives,
  decodeUsbDrivesHappening,
  usbRefuseData,
  type UsbDrive,
  type UsbDriveSet,
  type UsbRefuseData
} from "./usb-drives-decoders";

const SHELF = "storage.usb";
const PAYLOAD_VERSION = 1;

const MESSAGES = {
  wsUnavailable: () => t("collection.wsUnavailable"),
  notConnected: () => t("sources.notConnected"),
  noResponse: (n: number, detail: string) => t("sources.noResponse", { n, detail }),
  refused: () => t("sources.refused")
};

/** Verb result with the structured refuse payload attached, so the surface
 *  can render busy holders / oversized caps / colliding ids verbatim. */
export type UsbVerbResult =
  | { ok: true }
  | { ok: false; message: string; subclass: string | null; data: UsbRefuseData };

export interface UseUsbDrivesState {
  connection: SubjectConnectionState;
  /** null until the first read lands. */
  drives: UsbDrive[] | null;
  mount: (stableId: string) => Promise<UsbVerbResult>;
  safeRemove: (stableId: string, force?: boolean) => Promise<UsbVerbResult>;
  repair: (stableId: string, escalate?: boolean) => Promise<UsbVerbResult>;
  rename: (
    stableId: string,
    alias: string,
    mountPolicy?: string | null
  ) => Promise<UsbVerbResult>;
  /** Rebuild the bearer socket after inline pairing (storage_admin). */
  reauth: () => void;
}

function subclassOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const s = (error as Record<string, unknown>)["subclass"];
    if (typeof s === "string" && s.length > 0) return s;
  }
  return null;
}

export function useUsbDrives(): UseUsbDrivesState {
  const subject = useShelfSubject<UsbDriveSet>({
    shelf: SHELF,
    bearerToken: storedBearer(),
    readRequestType: "storage.usb.list_drives",
    decodeRead: decodeUsbDrives,
    decodeHappening: decodeUsbDrivesHappening,
    messages: MESSAGES
  });
  const { transportRef, reauth } = subject;

  // Raw dispatch: keep the structured refuse payload (holders / cap /
  // colliding id) that dispatchVoid would drop. Success carries no body
  // the surface needs - the subject republish delivers the new drive set.
  const dispatch = useCallback(
    async (
      requestType: string,
      envelope: Record<string, unknown>
    ): Promise<UsbVerbResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return {
          ok: false,
          message: MESSAGES.notConnected(),
          subclass: null,
          data: usbRefuseData(null)
        };
      }
      const result = await pluginRequest(transport, SHELF, requestType, {
        v: PAYLOAD_VERSION,
        ...envelope
      });
      if (result.error !== undefined) {
        return {
          ok: false,
          message: verbErrorMessage(result.error, MESSAGES.refused()),
          subclass: subclassOf(result.error),
          data: usbRefuseData(result.error)
        };
      }
      return { ok: true };
    },
    [transportRef]
  );

  const mount = useCallback(
    (stableId: string) => dispatch("storage.usb.mount", { stable_id: stableId }),
    [dispatch]
  );
  const safeRemove = useCallback(
    (stableId: string, force = false) =>
      dispatch("storage.usb.safe_remove", { stable_id: stableId, force }),
    [dispatch]
  );
  const repair = useCallback(
    (stableId: string, escalate = false) =>
      dispatch("storage.usb.repair_filesystem", {
        stable_id: stableId,
        escalate
      }),
    [dispatch]
  );
  const rename = useCallback(
    (stableId: string, alias: string, mountPolicy: string | null = null) =>
      dispatch("storage.usb.rename", {
        stable_id: stableId,
        alias,
        // Present on the wire but the runtime does not yet act on it -
        // send null until the policy-mutation UI exists (memo).
        mount_policy: mountPolicy
      }),
    [dispatch]
  );

  return {
    connection: subject.connection,
    drives: subject.state === null ? null : subject.state.drives,
    mount,
    safeRemove,
    repair,
    rename,
    reauth
  };
}
