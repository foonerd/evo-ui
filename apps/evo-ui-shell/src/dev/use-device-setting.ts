// One hook for designer controls that edit a DEVICE setting (the
// visualizer-studio pattern, extracted on its fourth appearance):
// seed from GET /settings, optimistic local state, PATCH with one
// revision-conflict retry, visible error flag. Every consolidation
// control (density, classical metadata, works shelf, collection
// view) speaks through this - one implementation, no drift.

import { useEffect, useRef, useState } from "preact/hooks";
import { GatewayClient } from "../core/gateway-client";

export function useDeviceSetting<T>(
  key: string,
  isValid: (v: unknown) => v is T,
  fallback: T
): { value: T; set: (next: T) => void; error: boolean } {
  const clientRef = useRef<GatewayClient | null>(null);
  if (clientRef.current === null) clientRef.current = new GatewayClient();
  const client = clientRef.current;
  const [value, setValue] = useState<T>(fallback);
  const [error, setError] = useState(false);
  const revRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const payload = await client.getUiSettings();
        if (!alive) return;
        revRef.current = payload.revision;
        const v = payload.settings[key];
        if (isValid(v)) setValue(v);
      } catch {
        // Designer still previews without the gateway.
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  const set = (next: T) => {
    setValue(next);
    setError(false);
    void (async () => {
      try {
        const payload = await client.patchUiSettings({ [key]: next }, revRef.current);
        revRef.current = payload.revision;
      } catch {
        try {
          const latest = await client.getUiSettings();
          const retry = await client.patchUiSettings({ [key]: next }, latest.revision);
          revRef.current = retry.revision;
        } catch {
          setError(true);
        }
      }
    })();
  };

  return { value, set, error };
}
