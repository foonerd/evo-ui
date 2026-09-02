// Bounded connect-retry for the WebSocket transport.

import type { WsTransport } from "./ws-transport.ts";
import {
  CRITICAL_BACKOFF_MS,
  CRITICAL_CONNECT_ATTEMPTS
} from "./deadline.ts";

/** Default (non-critical) connect attempts. */
export const MAX_CONNECT_ATTEMPTS = 5;

const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 3000, 5000];

/**
 * Canonical unbounded reconnect schedule for surfaces that must
 * survive a routine framework bounce (deploy-distribution, HTTPS
 * re-mint, operator-driven `systemctl restart evo`) without ever
 * dead-ending. A sub-15-second bounce is NORMATIVE on this device,
 * so a bounded budget calibrated for browser network hiccups turns
 * every deploy into apparent breakage. Steps ramp then hold at 60s;
 * callers loop over it with NO attempt ceiling.
 */
export const RECONNECT_BACKOFF_MS: readonly number[] = [
  500, 1000, 2000, 4000, 8000, 15_000, 30_000, 60_000
];

/**
 * Delay before reconnect attempt `attempt` (1-based) using the
 * canonical schedule, clamped to its final (60s) step for every
 * attempt past the ramp. There is deliberately no ceiling on
 * `attempt` — the caller keeps trying until the socket reopens.
 */
export function reconnectDelayMs(attempt: number): number {
  const i = Math.max(0, attempt - 1);
  return RECONNECT_BACKOFF_MS[Math.min(i, RECONNECT_BACKOFF_MS.length - 1)];
}

export {
  CRITICAL_CONNECT_ATTEMPTS,
  CRITICAL_BACKOFF_MS
};

export interface ConnectRetryOpts {
  maxAttempts?: number;
  backoffMs?: readonly number[];
}

/** Connect with bounded retry. Resolves on first success; rejects
 *  after maxAttempts failures. Returns early (no throw) when
 *  isCancelled() is true so callers must re-check cancelled. */
export async function connectWithRetry(
  transport: WsTransport,
  onAttempt: (attempt: number) => void,
  isCancelled: () => boolean,
  opts: ConnectRetryOpts = {}
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? MAX_CONNECT_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let lastError: unknown = new Error("connect not attempted");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (isCancelled()) return;
    onAttempt(attempt);
    try {
      await transport.connect();
      return;
    } catch (err) {
      lastError = err;
      if (isCancelled()) return;
      if (attempt < maxAttempts) {
        const wait =
          backoffMs[attempt - 1] ??
          backoffMs[backoffMs.length - 1] ??
          500;
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}
