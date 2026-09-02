import { useCallback, useRef, useState } from "preact/hooks";
import { GatewayClient } from "../../core/gateway-client";
import type {
  MaintenanceStatePayload,
  PluginsPayload,
  SshStatusPayload,
  UpdateStatusPayload
} from "../../core/types";

interface OperationsState {
  maintenance: MaintenanceStatePayload | null;
  updates: UpdateStatusPayload | null;
  plugins: PluginsPayload | null;
  ssh: SshStatusPayload | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: OperationsState = {
  maintenance: null,
  updates: null,
  plugins: null,
  ssh: null,
  loading: false,
  error: null
};

export function useOperationsState(client: GatewayClient) {
  const [state, setState] = useState<OperationsState>(INITIAL_STATE);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const run = (async () => {
      try {
        const [maintenance, updates, plugins, ssh] = await Promise.all([
          client.getMaintenanceState(),
          client.getUpdateStatus(),
          client.getPlugins(),
          client.getSshStatus()
        ]);
        setState({
          maintenance,
          updates,
          plugins,
          ssh,
          loading: false,
          error: null
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : "Operations refresh failed"
        }));
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [client]);

  return {
    ...state,
    refresh
  };
}
