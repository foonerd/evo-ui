// Live override sitting: the in-memory step-up token on the ONE
// StepUpHost. Settings entry uses this so a password override opens
// the surface; it is not a second password card and not a second
// identity.

import { useCallback, useEffect, useState } from "preact/hooks";
import { getStepUpBridge } from "../../runtime/ws-transport.ts";

export interface StepUpSitting {
  live: boolean;
  request: () => Promise<boolean>;
}

export function useStepUpSitting(): StepUpSitting {
  const [live, setLive] = useState(false);

  useEffect(() => {
    const bridge = getStepUpBridge();
    setLive(bridge?.getToken() != null);
    if (bridge?.subscribe === undefined) return undefined;
    return bridge.subscribe((token) => setLive(token != null));
  }, []);

  const request = useCallback(async (): Promise<boolean> => {
    const bridge = getStepUpBridge();
    if (bridge === null) return false;
    if (bridge.getToken() !== null) return true;
    const token = await bridge.acquire("household_override");
    if (token === null) return false;
    bridge.setToken(token);
    return true;
  }, []);

  return { live, request };
}
