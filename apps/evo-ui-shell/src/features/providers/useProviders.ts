// State + actions for the framework-wide online-provider config.
// Lists on mount via the shared framework transport; setEnabled /
// setPriority re-list on success. State-driven, no timers. The store
// hot-applies each change on its bus, so a toggle takes effect on the
// next metadata verb with no restart.
//
// Sockets: the list (online_providers_list) rides the shared
// page-lifetime LAN-trust socket. WRITES (online_providers_set_enabled /
// set_priority / set_privacy_mode) ride a private socket that presents
// the stored pair / kiosk bearer when one is stored (read at every
// handshake, rotated by the bearer bus, closed on unmount); with no
// bearer they stay on the shared socket. The shared socket is never
// given a bearer. See ../system/metadata-write-socket.ts.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  frameworkWsUrl,
  tryUseFrameworkTransport
} from "../../runtime/framework-transport";
import { WsTransport } from "../../runtime/ws-transport";
import { storedBearer, onBearerChange } from "../../runtime/bearer";
import { t } from "../../runtime/i18n";
import { metadataWriteSocket } from "../system/metadata-write-socket";
import {
  providersList,
  providersSetEnabled,
  providersSetPriority,
  providersSetPrivacyMode
} from "./provider-ops";
import type { ProviderEntry, PrivacyMode } from "./provider-decoders";

export type ProviderActionResult =
  | { ok: true }
  | { ok: false; message: string; subclass?: string | null };

export interface ProvidersState {
  /** null while the first listing is outstanding; [] is a genuine
   *  empty registry, never a failure. */
  entries: ProviderEntry[] | null;
  /** Device privacy posture from the listing; "enhanced" until the
   *  first list resolves. Drives suppression rendering. */
  privacyMode: PrivacyMode;
  error: string | null;
  busy: boolean;
  setEnabled: (
    providerId: string,
    enabled: boolean
  ) => Promise<ProviderActionResult>;
  setPriority: (
    providerId: string,
    priority: number
  ) => Promise<ProviderActionResult>;
  setPrivacyMode: (mode: PrivacyMode) => Promise<ProviderActionResult>;
  refresh: () => Promise<void>;
}

/** Default cascade priority the store treats as "unset" upper-middle. */
export const DEFAULT_PRIORITY = 100;

/** The write socket could not open (bearer refused at the upgrade,
 *  device down): an honest refusal, never a throw out of a setter. */
function socketRefusal(err: unknown): ProviderActionResult {
  return {
    ok: false,
    message: err instanceof Error ? err.message : String(err)
  };
}

export function useProviders(): ProvidersState {
  const transport = tryUseFrameworkTransport();
  const [entries, setEntries] = useState<ProviderEntry[] | null>(null);
  const [privacyMode, setPrivacyModeState] = useState<PrivacyMode>("enhanced");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  // The write socket for a session with a stored bearer. Opened lazily
  // on the first bearer write, reads the bearer at every handshake, and
  // is re-handshaken by the bearer bus (a pair or a purge) so it never
  // keeps an identity the session has left. Closed on unmount. The
  // shared socket is never given a bearer: the list stays anonymous.
  const writeTxRef = useRef<WsTransport | null>(null);
  useEffect(() => {
    const off = onBearerChange(() => {
      const tx = writeTxRef.current;
      if (tx !== null) tx.rotateBearer();
    });
    return () => {
      off();
      const tx = writeTxRef.current;
      writeTxRef.current = null;
      if (tx !== null) void tx.close();
    };
  }, []);
  const writeTransport = useCallback((): WsTransport | null => {
    // No framework transport in this page (designer / tests): nothing
    // to write to, bearer or not.
    if (transport === null) return null;
    if (metadataWriteSocket(storedBearer() !== undefined) === "shared") {
      return transport;
    }
    let tx = writeTxRef.current;
    if (tx === null) {
      // With a bearer stored, a write never falls back to the shared
      // socket: no WebSocket means no socket at all.
      if (typeof WebSocket === "undefined") return null;
      tx = new WsTransport({ url: frameworkWsUrl(), bearerSource: storedBearer });
      writeTxRef.current = tx;
    }
    return tx;
  }, [transport]);

  const refresh = useCallback(async (): Promise<void> => {
    if (transport === null) {
      setError(t("providers.notConnected"));
      return;
    }
    const r = await providersList(transport);
    if (cancelledRef.current) return;
    if (r.ok) {
      // Order by effective priority (unset -> default), then name, so
      // the panel renders the actual cascade order.
      const sorted = [...r.value.entries].sort((a, b) => {
        const pa = a.priority ?? DEFAULT_PRIORITY;
        const pb = b.priority ?? DEFAULT_PRIORITY;
        return pa !== pb
          ? pa - pb
          : a.providerId.localeCompare(b.providerId);
      });
      setEntries(sorted);
      setPrivacyModeState(r.value.privacyMode);
      setError(null);
    } else {
      setError(r.message);
    }
  }, [transport]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (
      providerId: string,
      enabled: boolean
    ): Promise<ProviderActionResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: t("providers.notConnected") };
      }
      setBusy(true);
      let r: Awaited<ReturnType<typeof providersSetEnabled>>;
      try {
        r = await providersSetEnabled(tx, providerId, enabled);
      } catch (err) {
        setBusy(false);
        return socketRefusal(err);
      }
      if (r.ok) await refresh();
      setBusy(false);
      return r.ok
        ? { ok: true }
        : { ok: false, message: r.message, subclass: r.subclass };
    },
    [writeTransport, refresh]
  );

  const setPriority = useCallback(
    async (
      providerId: string,
      priority: number
    ): Promise<ProviderActionResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: t("providers.notConnected") };
      }
      setBusy(true);
      let r: Awaited<ReturnType<typeof providersSetPriority>>;
      try {
        r = await providersSetPriority(tx, providerId, priority);
      } catch (err) {
        setBusy(false);
        return socketRefusal(err);
      }
      if (r.ok) await refresh();
      setBusy(false);
      return r.ok
        ? { ok: true }
        : { ok: false, message: r.message, subclass: r.subclass };
    },
    [writeTransport, refresh]
  );

  const setPrivacyMode = useCallback(
    async (mode: PrivacyMode): Promise<ProviderActionResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: t("providers.notConnected") };
      }
      setBusy(true);
      let r: Awaited<ReturnType<typeof providersSetPrivacyMode>>;
      try {
        r = await providersSetPrivacyMode(tx, mode);
      } catch (err) {
        setBusy(false);
        return socketRefusal(err);
      }
      if (r.ok) await refresh();
      setBusy(false);
      return r.ok
        ? { ok: true }
        : { ok: false, message: r.message, subclass: r.subclass };
    },
    [writeTransport, refresh]
  );

  return {
    entries,
    privacyMode,
    error,
    busy,
    setEnabled,
    setPriority,
    setPrivacyMode,
    refresh
  };
}
