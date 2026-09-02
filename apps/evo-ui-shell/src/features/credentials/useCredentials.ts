// State + actions for a plugin's credential inventory. Lists on mount
// via the shared framework transport, and exposes add / remove that
// re-list on success. State-driven: no timers.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { t } from "../../runtime/i18n";
import {
  credentialListKeys,
  credentialPut,
  credentialDelete
} from "./credential-ops";
import type { CredentialEntry } from "./credential-decoders";

export type CredentialActionResult =
  | { ok: true }
  | { ok: false; message: string };

export interface CredentialsState {
  /** null while the first listing is outstanding; [] is a genuine
   *  empty inventory (fresh install), never a failure. */
  entries: CredentialEntry[] | null;
  error: string | null;
  addKey: (args: {
    key: string;
    value: string;
    displayName: string;
  }) => Promise<CredentialActionResult>;
  removeKey: (keyHash: string) => Promise<CredentialActionResult>;
  refresh: () => Promise<void>;
}

export function useCredentials(pluginId: string): CredentialsState {
  const transport = tryUseFrameworkTransport();
  const [entries, setEntries] = useState<CredentialEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (transport === null) {
      setError(t("credentials.notConnected"));
      return;
    }
    const r = await credentialListKeys(transport, pluginId);
    if (cancelledRef.current) return;
    if (r.ok) {
      setEntries(r.value.entries);
      setError(null);
    } else {
      setError(r.message);
    }
  }, [transport, pluginId]);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  const addKey = useCallback(
    async (args: {
      key: string;
      value: string;
      displayName: string;
    }): Promise<CredentialActionResult> => {
      if (transport === null) {
        return { ok: false, message: t("credentials.notConnected") };
      }
      const r = await credentialPut(transport, {
        pluginId,
        key: args.key,
        value: args.value,
        displayName: args.displayName
      });
      if (!r.ok) return { ok: false, message: r.message };
      await refresh();
      return { ok: true };
    },
    [transport, pluginId, refresh]
  );

  const removeKey = useCallback(
    async (keyHash: string): Promise<CredentialActionResult> => {
      if (transport === null) {
        return { ok: false, message: t("credentials.notConnected") };
      }
      const r = await credentialDelete(transport, pluginId, keyHash);
      if (!r.ok) return { ok: false, message: r.message };
      await refresh();
      return { ok: true };
    },
    [transport, pluginId, refresh]
  );

  return { entries, error, addKey, removeKey, refresh };
}
