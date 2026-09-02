// State + actions for the framework-wide online-provider config.
// Lists on mount via the shared framework transport; setEnabled /
// setPriority re-list on success. State-driven, no timers. The store
// hot-applies each change on its bus, so a toggle takes effect on the
// next metadata verb with no restart.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { t } from "../../runtime/i18n";
import {
  providersList,
  providersSetEnabled,
  providersSetPriority
} from "./provider-ops";
import type { ProviderEntry } from "./provider-decoders";

export type ProviderActionResult =
  | { ok: true }
  | { ok: false; message: string };

export interface ProvidersState {
  /** null while the first listing is outstanding; [] is a genuine
   *  empty registry, never a failure. */
  entries: ProviderEntry[] | null;
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
  refresh: () => Promise<void>;
}

/** Default cascade priority the store treats as "unset" upper-middle. */
export const DEFAULT_PRIORITY = 100;

export function useProviders(): ProvidersState {
  const transport = tryUseFrameworkTransport();
  const [entries, setEntries] = useState<ProviderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

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
      if (transport === null) {
        return { ok: false, message: t("providers.notConnected") };
      }
      setBusy(true);
      const r = await providersSetEnabled(transport, providerId, enabled);
      if (r.ok) await refresh();
      setBusy(false);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    [transport, refresh]
  );

  const setPriority = useCallback(
    async (
      providerId: string,
      priority: number
    ): Promise<ProviderActionResult> => {
      if (transport === null) {
        return { ok: false, message: t("providers.notConnected") };
      }
      setBusy(true);
      const r = await providersSetPriority(transport, providerId, priority);
      if (r.ok) await refresh();
      setBusy(false);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    [transport, refresh]
  );

  return { entries, error, busy, setEnabled, setPriority, refresh };
}
