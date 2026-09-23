// origin-write-registry - write sockets that can raise a prompt (Add
// share on the shares bearer socket). PromptSurface lists those
// connections as origin, not only the separate seat socket.

import type { WsTransport } from "../../runtime/ws-transport";

const transports = new Map<string, WsTransport>();
const listeners = new Set<() => void>();
const reseedListeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function registerOriginWriteTransport(
  id: string,
  transport: WsTransport
): void {
  if (transports.get(id) === transport) return;
  transports.set(id, transport);
  announce();
}

export function unregisterOriginWriteTransport(id: string): void {
  if (!transports.delete(id)) return;
  announce();
}

export function originWriteTransports(): ReadonlyMap<string, WsTransport> {
  return transports;
}

export function onOriginWriteTransportsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onOriginWriteReseed(listener: () => void): () => void {
  reseedListeners.add(listener);
  return () => {
    reseedListeners.delete(listener);
  };
}

export function nudgeOriginWriteReseed(): void {
  for (const listener of reseedListeners) listener();
}
