// Playback session boot — pure async control flow, no React.
//
// Framework contract (org.evoframework.playback.mpd):
//   - now_playing / stream_format subjects are transition-only
//   - get_now_playing / get_stream_format seed first render
//   - then subscribe_happenings for deltas
//
// Shell contract:
//   - Healthy F5: connect + seed fast; "connecting" is quiet chrome
//     (no maintenance popup).
//   - Real degrade (error / disconnect after loss): operator MUST
//     see an unambiguous popup (restart / upgrade / maintenance).
//   - If the shared socket is already OPEN, seed immediately —
//     do not wait for a second "open" event that will never fire.

import type { WsTransport } from "../../runtime/ws-transport.ts";
import { pluginRequest } from "../../runtime/plugin-request-codec.ts";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter.ts";
import {
  connectWithRetry,
  CRITICAL_BACKOFF_MS,
  CRITICAL_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry.ts";
import {
  deadlineSignal,
  DEFAULT_SEED_DEADLINE_MS,
  RECOVER_PAUSE_MS
} from "../../runtime/deadline.ts";
import {
  decodeNowPlaying,
  decodeNowPlayingHappening,
  type NowPlaying
} from "./now-playing-decoders.ts";
import {
  decodeStreamFormat,
  decodeStreamFormatHappening,
  type StreamFormat
} from "../audio/stream-format-decoders.ts";

const PLAYBACK_SHELF = "audio.playback";
const PAYLOAD_VERSION = 1;

export type PlaybackSessionConnection =
  | { kind: "connecting"; attempt?: number }
  | { kind: "connected" }
  | { kind: "disconnected"; reason?: string }
  | { kind: "error"; reason: string };

export interface PlaybackSessionHandlers {
  onConnection: (state: PlaybackSessionConnection) => void;
  onNowPlaying: (state: NowPlaying) => void;
  onStreamFormat: (state: StreamFormat) => void;
  isCancelled: () => boolean;
}

export interface PlaybackSessionHandle {
  stop: () => void;
}

export function startPlaybackSession(
  transport: WsTransport,
  handlers: PlaybackSessionHandlers
): PlaybackSessionHandle {
  let stopped = false;
  const teardowns: Array<() => void> = [];
  let subscribed = false;
  /** Suppress disconnected popup during the initial boot attempts. */
  let bootComplete = false;

  const isCancelled = (): boolean => stopped || handlers.isCancelled();

  const handleHappening = (raw: unknown): void => {
    if (isCancelled()) return;
    const np = decodeNowPlayingHappening(raw);
    if (np !== null) handlers.onNowPlaying(np);
    const sf = decodeStreamFormatHappening(raw);
    if (sf !== null) handlers.onStreamFormat(sf);
  };

  const seedParallel = (): void => {
    // No deadline on the transition-only seed reads. The read carries
    // the only current-state snapshot and the subject never replays it,
    // so aborting on a clock left the UI stuck. The reads are fast and
    // fire-and-forget (below); a slow one completes when it can, and the
    // subscription carries deltas meanwhile - nothing blocks or blanks.
    const seedNowPlaying = async (): Promise<void> => {
      const initial = await pluginRequest(
        transport,
        PLAYBACK_SHELF,
        "get_now_playing",
        { v: PAYLOAD_VERSION }
      );
      if (!isCancelled() && initial.error === undefined) {
        const seeded = decodeNowPlaying(initial.value);
        if (seeded !== null) handlers.onNowPlaying(seeded);
      }
    };
    const seedStreamFormat = async (): Promise<void> => {
      const initialFormat = await pluginRequest(
        transport,
        PLAYBACK_SHELF,
        "get_stream_format",
        { v: PAYLOAD_VERSION }
      );
      if (!isCancelled() && initialFormat.error === undefined) {
        const seeded = decodeStreamFormat(initialFormat.value);
        if (seeded !== null) handlers.onStreamFormat(seeded);
      }
    };
    void seedNowPlaying();
    void seedStreamFormat();
  };

  const ensureSubscribed = (): void => {
    if (subscribed || isCancelled()) return;
    subscribed = true;
    teardowns.push(transport.onHappening((f) => handleHappening(f.happening)));
    const subscriptionAbort = new AbortController();
    teardowns.push(() => subscriptionAbort.abort());
    void (async (): Promise<void> => {
      // keepalive_ms opts this subscription into the framework's
      // application heartbeat. now_playing is transition-only, so a
      // healthy-but-quiet subscription and a silently-dead one look
      // identical without it; the transport's per-subscription watchdog
      // turns a missed heartbeat into a reconnect, and the boot re-seed
      // rides the onConnectionChange("open") that follows. 10s cadence =
      // ~30s to detect+recover, comfortably under the operator's notice
      // for the rare dead-subscription case, no load in steady state.
      const stream = transport.subscribe(
        "subscribe_happenings",
        { ...DENY_SPECTRUM_PAYLOAD, keepalive_ms: 10_000 },
        { signal: subscriptionAbort.signal }
      );
      try {
        for await (const event of stream) {
          if (isCancelled()) return;
          handleHappening(event);
        }
      } catch {
        // ended; transport reconnect re-subscribes active ids
      }
    })();
  };

  const onLive = (): void => {
    handlers.onConnection({ kind: "connected" });
    ensureSubscribed();
    seedParallel();
  };

  teardowns.push(
    transport.onConnectionChange((socketState) => {
      if (isCancelled()) return;
      if (socketState === "closed") {
        // During initial boot, open-deadline close must not raise
        // a maintenance popup — that is retry theatre, not restart.
        if (!bootComplete) return;
        handlers.onConnection({
          kind: "disconnected",
          reason: "Connection lost - reconnecting (restart or network)."
        });
        return;
      }
      // Re-open after a real drop: inform was already shown; seed again.
      onLive();
    })
  );

  const boot = async (): Promise<void> => {
    while (!isCancelled()) {
      try {
        // Quiet: connecting never triggers the maintenance popup.
        handlers.onConnection({ kind: "connecting" });

        // Already-open shared socket (Strict remount / prior session):
        // seed now — there will be no second "open" event.
        if (transport.isOpen()) {
          bootComplete = true;
          onLive();
          return;
        }

        await connectWithRetry(
          transport,
          (attempt) => {
            if (!isCancelled()) {
              handlers.onConnection({ kind: "connecting", attempt });
            }
          },
          isCancelled,
          {
            maxAttempts: CRITICAL_CONNECT_ATTEMPTS,
            backoffMs: CRITICAL_BACKOFF_MS
          }
        );
        if (isCancelled()) return;
        bootComplete = true;
        // open listener may have already called onLive; call again
        // is idempotent (ensureSubscribed once, seed again is fine).
        onLive();
        return;
      } catch (err) {
        if (isCancelled()) return;
        const detail = err instanceof Error ? err.message : String(err);
        // Loud on purpose: steward unreachable after critical budget
        // (restart / upgrade / maintenance / network).
        handlers.onConnection({
          kind: "error",
          reason:
            "Playback did not respond - the service may be restarting " +
            `or upgrading. Retrying. (${detail})`
        });
        await new Promise<void>((resolve) =>
          setTimeout(resolve, RECOVER_PAUSE_MS)
        );
      }
    }
  };

  void boot();

  return {
    stop: () => {
      stopped = true;
      for (const t of teardowns.splice(0)) t();
    }
  };
}

export async function dispatchPlaybackVerb(
  transport: WsTransport,
  requestType: string,
  envelope: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const d = deadlineSignal(DEFAULT_SEED_DEADLINE_MS);
  try {
    const result = await pluginRequest(
      transport,
      PLAYBACK_SHELF,
      requestType,
      { v: PAYLOAD_VERSION, ...envelope },
      { signal: d.signal }
    );
    if (result.error !== undefined) {
      return { ok: false, message: errorMessage(result.error) };
    }
    return { ok: true };
  } finally {
    d.cancel();
  }
}

export async function refreshNowPlayingSeed(
  transport: WsTransport
): Promise<
  | { ok: true; value: NowPlaying }
  | { ok: false; message: string }
> {
  // Transition-only re-read: no clock. See seedParallel above.
  const result = await pluginRequest(
    transport,
    PLAYBACK_SHELF,
    "get_now_playing",
    { v: PAYLOAD_VERSION }
  );
  if (result.error !== undefined) {
    return { ok: false, message: errorMessage(result.error) };
  }
  const fresh = decodeNowPlaying(result.value);
  if (fresh === null) {
    return { ok: false, message: "now_playing decode refused" };
  }
  return { ok: true, value: fresh };
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const rec = error as Record<string, unknown>;
    const message = rec["message"];
    if (typeof message === "string" && message.length > 0) return message;
    const subclass = rec["subclass"];
    if (typeof subclass === "string" && subclass.length > 0) {
      return `Framework refused: ${subclass}`;
    }
  }
  return "The playback system refused the command.";
}
