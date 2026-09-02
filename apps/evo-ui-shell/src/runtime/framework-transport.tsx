// Page-lifetime shared WebSocket for the operator shell.
//
// Lifetime rule (load-bearing): this transport is NOT closed on
// React effect cleanup. Preact/React Strict Mode remounts would
// otherwise close() the socket, leave `closing=true`, and leave
// the shell permanently unable to connect. The socket is torn
// down by WsTransport's pagehide handler on real navigation/unload.
//
// Consumers: playback (critical path) plus anonymous secondary
// shelves (queue, favourites, notifications via attachSharedHappenings).
// Bearer-scoped surfaces keep a private socket — never setBearerToken
// here for a single shelf (that would rewrite grants for everyone).

import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useRef } from "preact/hooks";

import { DEFAULT_OPEN_DEADLINE_MS } from "./deadline.ts";
import { WsTransport } from "./ws-transport.ts";

const FrameworkTransportContext = createContext<WsTransport | null>(null);

export function frameworkWsUrl(): string {
  if (typeof window === "undefined") {
    return "ws://localhost/api/v1/ws";
  }
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

export function FrameworkTransportProvider({
  children,
  transport: injected
}: {
  children: ComponentChildren;
  /** Test seam: inject a pre-built transport (not closed by us). */
  transport?: WsTransport;
}) {
  const ownedRef = useRef<WsTransport | null>(null);
  if (injected === undefined && ownedRef.current === null) {
    ownedRef.current = new WsTransport({
      url: frameworkWsUrl(),
      openTimeoutMs: DEFAULT_OPEN_DEADLINE_MS
    });
  }
  const transport = injected ?? ownedRef.current;
  if (transport === null) {
    throw new Error("FrameworkTransportProvider failed to create transport");
  }

  return (
    <FrameworkTransportContext.Provider value={transport}>
      {children}
    </FrameworkTransportContext.Provider>
  );
}

export function useFrameworkTransport(): WsTransport {
  const transport = useContext(FrameworkTransportContext);
  if (transport === null) {
    throw new Error(
      "useFrameworkTransport() requires <FrameworkTransportProvider>"
    );
  }
  return transport;
}

/** Shared transport when under PlayerShellProviders; null in
 *  designer / tests that mount a feature hook alone. Callers MUST
 *  fall back to a private socket when null (and close that private
 *  socket on unmount). */
export function tryUseFrameworkTransport(): WsTransport | null {
  return useContext(FrameworkTransportContext);
}
