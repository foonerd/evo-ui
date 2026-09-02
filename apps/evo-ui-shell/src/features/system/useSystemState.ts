import { useCallback } from "preact/hooks";
import type { GatewayClient } from "../../core/gateway-client";
import type { NetworkStatusPayload } from "../../core/types";

// Neither output-device nor network status is fetched over HTTP here.
// Output selection moved to the framework plugin-request path; network
// connectivity + intent moved to the networking.link WS shelf
// (useNetworkLink - the reachability pill + all controls). The former
// /api/ui/v1/network/status HTTP route was never implemented by the
// runtime (it 404s, exactly like the retired /outputs route), so the
// stray fetch is retired. This hook is now a stable no-op shell kept
// only so its callers' refresh() effects stay wired; there is no
// second, HTTP-based source of network truth.

interface SystemState {
  network: NetworkStatusPayload | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SystemState = {
  network: null,
  loading: false,
  error: null
};

export function useSystemState(_client: GatewayClient) {
  const refresh = useCallback(async () => {
    // No HTTP network fetch: the networking.link WS shelf is the sole
    // source of connectivity truth (useNetworkLink). Kept as a resolved
    // no-op so existing refresh() call sites remain valid.
  }, []);

  return {
    ...INITIAL_STATE,
    refresh
  };
}
