// Gates non-critical WebSocket consumers until the player critical
// path has a live connection. Absent a provider, consumers stay
// enabled (library/queue surfaces visited after boot).

import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

const SecondaryLiveContext = createContext<boolean | null>(null);

export function SecondaryLiveProvider({
  ready,
  children
}: {
  ready: boolean;
  children: ComponentChildren;
}) {
  return (
    <SecondaryLiveContext.Provider value={ready}>
      {children}
    </SecondaryLiveContext.Provider>
  );
}

/** False only while App explicitly defers secondary sockets. */
export function useSecondaryLive(): boolean {
  const v = useContext(SecondaryLiveContext);
  return v === null ? true : v;
}
