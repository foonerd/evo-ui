// State + actions for a plugin's credential inventory. Lists on mount
// via the shared framework transport, and exposes add / remove that
// re-list on success. State-driven: no timers.
//
// Sockets: the list (credential_list_keys) rides the shared
// page-lifetime LAN-trust socket. WRITES (credential_put /
// credential_delete) ride a private socket that presents the stored
// pair / kiosk bearer when one is stored (read at every handshake,
// rotated by the bearer bus, closed on unmount); with no bearer they
// stay on the shared socket. The shared socket is never given a
// bearer. See ../system/metadata-write-socket.ts.

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
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: t("credentials.notConnected") };
      }
      let r: Awaited<ReturnType<typeof credentialPut>>;
      try {
        r = await credentialPut(tx, {
          pluginId,
          key: args.key,
          value: args.value,
          displayName: args.displayName
        });
      } catch (err) {
        // The write socket could not open (bearer refused at the
        // upgrade, device down): an honest refusal, never a throw.
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err)
        };
      }
      if (!r.ok) return { ok: false, message: r.message };
      await refresh();
      return { ok: true };
    },
    [writeTransport, pluginId, refresh]
  );

  const removeKey = useCallback(
    async (keyHash: string): Promise<CredentialActionResult> => {
      const tx = writeTransport();
      if (tx === null) {
        return { ok: false, message: t("credentials.notConnected") };
      }
      let r: Awaited<ReturnType<typeof credentialDelete>>;
      try {
        r = await credentialDelete(tx, pluginId, keyHash);
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err)
        };
      }
      if (!r.ok) return { ok: false, message: r.message };
      await refresh();
      return { ok: true };
    },
    [writeTransport, pluginId, refresh]
  );

  return { entries, error, addKey, removeKey, refresh };
}
