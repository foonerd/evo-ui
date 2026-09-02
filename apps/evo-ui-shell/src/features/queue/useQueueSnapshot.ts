import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { GatewayClient } from "../../core/gateway-client";
import type { QueueSnapshotPayload } from "../../core/types";
import { shouldMarkSnapshotStale } from "../../core/freshness-policy";
import { t } from "../../runtime/i18n";

interface QueueSnapshotState {
  snapshot: QueueSnapshotPayload | null;
  loading: boolean;
  error: string | null;
  freshness: "fresh" | "stale" | "reconnecting";
  lastUpdatedAt: number | null;
}

const INITIAL_STATE: QueueSnapshotState = {
  snapshot: null,
  loading: false,
  error: null,
  freshness: "stale",
  lastUpdatedAt: null
};

export function useQueueSnapshot(client: GatewayClient) {
  const [state, setState] = useState<QueueSnapshotState>(INITIAL_STATE);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      freshness: prev.snapshot ? "reconnecting" : prev.freshness
    }));
    const run = (async () => {
      try {
        const snapshot = await client.getQueue();
        setState({
          snapshot,
          loading: false,
          error: null,
          freshness: "fresh",
          lastUpdatedAt: Date.now()
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : t("queue.snapshotLoadFailed"),
          freshness: prev.snapshot ? "stale" : prev.freshness
        }));
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, [client]);

  useEffect(() => {
    if (!state.lastUpdatedAt || state.loading) {
      return;
    }
    const id = setInterval(() => {
      const ageMs = Date.now() - state.lastUpdatedAt!;
      if (shouldMarkSnapshotStale(ageMs)) {
        setState((prev) => ({ ...prev, freshness: "stale" }));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state.lastUpdatedAt, state.loading]);

  return {
    ...state,
    refresh,
    optimisticUpdate: (
      updater: (snapshot: QueueSnapshotPayload | null) => QueueSnapshotPayload | null
    ) => {
      setState((prev) => ({
        ...prev,
        snapshot: updater(prev.snapshot),
        freshness: prev.snapshot ? "fresh" : prev.freshness
      }));
    },
    restoreSnapshot: (snapshot: QueueSnapshotPayload | null) => {
      setState((prev) => ({
        ...prev,
        snapshot,
        freshness: snapshot ? "fresh" : prev.freshness
      }));
    }
  };
}
