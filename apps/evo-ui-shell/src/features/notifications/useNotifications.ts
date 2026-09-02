// useNotifications - read-then-subscribe hook for the
// system.notifications shelf (Phase 2b), built ON the shared
// useShelfSubject factory per plan law - no hand-rolled lifecycle.

import { useCallback } from "preact/hooks";
import {
  useShelfSubject,
  type SubjectConnectionState,
  type SubjectVerbResult
} from "../../runtime/use-shelf-subject";
import { t } from "../../runtime/i18n";
import {
  decodeNotificationsState,
  decodeNotificationsHappening,
  type NotificationsState
} from "./notification-decoders";

const SHELF = "system.notifications";

export interface UseNotificationsState {
  connection: SubjectConnectionState;
  state: NotificationsState | null;
  /** Dismiss one notification by handle
   *  (system.notifications.cancel). */
  cancel: (handle: number) => Promise<SubjectVerbResult>;
  /** Set the base mode: display_only / chime / voice. */
  setBaseMode: (mode: string) => Promise<SubjectVerbResult>;
  /** Set (or clear, with 0/0) the quiet-hours window. */
  setQuietHours: (
    startMinute: number,
    endMinute: number,
    downgradeMode: string
  ) => Promise<SubjectVerbResult>;
}

export function useNotifications(): UseNotificationsState {
  const subject = useShelfSubject<NotificationsState>({
    shelf: SHELF,
    readRequestType: "system.notifications.list_active",
    decodeRead: decodeNotificationsState,
    decodeHappening: decodeNotificationsHappening,
    messages: {
      wsUnavailable: () => t("collection.wsUnavailable"),
      notConnected: () => t("notify.notConnected"),
      noResponse: (n, detail) => t("notify.noResponse", { n, detail }),
      refused: () => t("notify.refused")
    }
  });
  const { dispatchVoid } = subject;

  const cancel = useCallback(
    (handle: number) => dispatchVoid("system.notifications.cancel", { handle }),
    [dispatchVoid]
  );
  const setBaseMode = useCallback(
    (mode: string) => dispatchVoid("system.notifications.set_base_mode", { mode }),
    [dispatchVoid]
  );
  const setQuietHours = useCallback(
    (startMinute: number, endMinute: number, downgradeMode: string) =>
      dispatchVoid("system.notifications.set_quiet_hours", {
        // The verb requires an explicit enabled flag (discovered on
        // the wire; the widget doc omits it): 0/0 alone does not
        // disable - enabled:false does.
        enabled: !(startMinute === 0 && endMinute === 0),
        start_minute: startMinute,
        end_minute: endMinute,
        downgrade_mode: downgradeMode
      }),
    [dispatchVoid]
  );

  return { connection: subject.connection, state: subject.state, cancel, setBaseMode, setQuietHours };
}
