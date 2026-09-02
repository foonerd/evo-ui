// Attach a secondary feature to the page-lifetime FrameworkTransport.
//
// Lifetime law (load-bearing):
//   - Features own subscriptions, not the socket.
//   - Cleanup MUST abort this feature's subscribe / happening listener.
//   - Cleanup MUST NOT call transport.close() on the shared socket.
//   - Bearer-scoped surfaces keep a private socket (see useShelfSubject).
//
// Why: landing used to open a fresh WsTransport per hook the moment
// playback became connected. That wave contended with the player
// socket and could churn PlaybackConnectionChrome. Multiplexing
// anonymous shelves onto the shared transport removes the wave.

import type { WsTransport } from "./ws-transport.ts";
import { connectWithRetry, MAX_CONNECT_ATTEMPTS } from "./connect-retry.ts";
import { DENY_SPECTRUM_PAYLOAD } from "./happenings-filter.ts";

export interface SharedAttachHandlers {
  onConnecting: (attempt?: number) => void;
  onConnected: () => void;
  onError: (attempts: number, detail: string) => void;
  isCancelled: () => boolean;
  /** Seed reads + any non-happenings setup after the socket is live. */
  afterOpen: () => Promise<void>;
  /** Decode one happenings frame (shared bus — reject foreign frames). */
  onHappening: (raw: unknown) => void;
  /** subscribe_happenings filter. Default denies spectrum (~30 Hz).
   *  Visualiser passes ALLOW_SPECTRUM_PAYLOAD. */
  subscribePayload?: Readonly<Record<string, unknown>>;
}

export interface SharedAttachHandle {
  stop: () => void;
}

/** Ensure the shared transport is open, then seed and subscribe.
 *  Returns a stop() that tears down only this attach. */
export function attachSharedHappenings(
  transport: WsTransport,
  handlers: SharedAttachHandlers
): SharedAttachHandle {
  let cancelled = false;
  const subAbort = new AbortController();
  let offHappening: (() => void) | undefined;
  const subscribePayload = handlers.subscribePayload ?? DENY_SPECTRUM_PAYLOAD;

  const isCancelled = (): boolean => cancelled || handlers.isCancelled();

  const run = async (): Promise<void> => {
    try {
      handlers.onConnecting();
      if (!transport.isOpen()) {
        await connectWithRetry(
          transport,
          (attempt) => {
            if (!isCancelled()) handlers.onConnecting(attempt);
          },
          isCancelled
        );
      }
      if (isCancelled()) return;
      handlers.onConnected();
      await handlers.afterOpen();
      if (isCancelled()) return;

      const handle = (raw: unknown): void => {
        if (isCancelled()) return;
        handlers.onHappening(raw);
      };
      offHappening = transport.onHappening((f) => handle(f.happening));
      void (async (): Promise<void> => {
        const stream = transport.subscribe(
          "subscribe_happenings",
          subscribePayload as Record<string, unknown>,
          { signal: subAbort.signal }
        );
        try {
          for await (const event of stream) {
            if (isCancelled()) return;
            handle(event);
          }
        } catch {
          // Subscription ended; feature remount / reconnect re-attaches.
        }
      })();
    } catch (err) {
      if (isCancelled()) return;
      const detail = err instanceof Error ? err.message : String(err);
      handlers.onError(MAX_CONNECT_ATTEMPTS, detail);
    }
  };

  void run();

  return {
    stop: () => {
      cancelled = true;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
    }
  };
}
