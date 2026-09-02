import { useEffect, useMemo, useState } from "preact/hooks";
import { UiGatewayStream } from "./ws-stream";
import { buildStreamNextState, INITIAL_STREAM_STATE, type StreamState } from "./stream-state";

export function useGatewayStream(wsUrl: string, enabled: boolean) {
  const stream = useMemo(() => new UiGatewayStream(wsUrl), [wsUrl]);
  const [state, setState] = useState<StreamState>(INITIAL_STREAM_STATE);

  useEffect(() => {
    if (!enabled) {
      stream.disconnect();
      setState(INITIAL_STREAM_STATE);
      return;
    }

    const unsubStatus = stream.onStatus((status, reason) => {
      setState((prev) => ({
        ...prev,
        status,
        reason: reason ?? null
      }));
    });
    const unsubEvent = stream.onEvent((frame) => {
      setState((prev) => ({
        ...buildStreamNextState(prev, frame),
      }));
    });

    stream.connect();
    return () => {
      unsubStatus();
      unsubEvent();
      stream.disconnect();
    };
  }, [enabled, stream]);

  return state;
}
