// Live-spectrum state hook.
//
// Multiplexes onto the page-lifetime FrameworkTransport with an
// ALLOW_SPECTRUM subscribe filter. Owns the subscription only —
// never closes the shared socket. When the visualiser is off, no
// subscribe is opened (honest toggle). Designer mounts without a
// provider keep a private socket.

import { useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { ALLOW_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import {
  connectWithRetry,
  MAX_CONNECT_ATTEMPTS
} from "../../runtime/connect-retry";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { attachSharedHappenings } from "../../runtime/shared-framework-attach";
import { frameworkUrl } from "../../runtime/use-shelf-subject";
import {
  decodeSpectrumFrameInto,
  decodeSpectrumFrameHappeningInto,
  emptySpectrumBuffers,
  SPECTRUM_READ_VERB,
  SPECTRUM_SHELF,
  type SpectrumFrameBuffers
} from "./spectrum-decoders";

interface SpectrumDiag {
  wsState: "connecting" | "connected" | "error";
  wsAttempts: number;
  subEventCount: number;
  spectrumDecodeOk: number;
  spectrumDecodeReject: number;
  spectrumSeedOk: number;
  spectrumSeedReject: number;
  lastAtMs: number;
  lastDecodeWallMs: number;
  lastClockDeltaMs: number;
  lastFrameMaxL: number;
  lastFrameMaxR: number;
}
function getSpectrumDiag(): SpectrumDiag {
  const w = typeof window === "undefined"
    ? ({} as Record<string, unknown>)
    : (window as unknown as Record<string, unknown>);
  let diag = w["__spectrumDiag"] as SpectrumDiag | undefined;
  if (diag === undefined) {
    diag = {
      wsState: "connecting",
      wsAttempts: 0,
      subEventCount: 0,
      spectrumDecodeOk: 0,
      spectrumDecodeReject: 0,
      spectrumSeedOk: 0,
      spectrumSeedReject: 0,
      lastAtMs: 0,
      lastDecodeWallMs: 0,
      lastClockDeltaMs: 0,
      lastFrameMaxL: 0,
      lastFrameMaxR: 0
    };
    if (typeof window !== "undefined") {
      w["__spectrumDiag"] = diag;
    }
  }
  return diag;
}

export type SpectrumConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface SpectrumConnectionState {
  kind: SpectrumConnectionKind;
  reason?: string;
  attempt?: number;
}

export interface SpectrumState {
  connection: SpectrumConnectionState;
  frameRef: { readonly current: SpectrumFrameBuffers };
}

const PAYLOAD_VERSION = 1;

function spectrumConnectError(detail: string): string {
  return (
    "The audio terminus did not respond after " +
    `${MAX_CONNECT_ATTEMPTS} connection attempts. It may be ` +
    `restarting. Last error: ${detail}`
  );
}

export function useSpectrum(enabled: boolean = true): SpectrumState {
  const sharedTransport = tryUseFrameworkTransport();
  const [connection, setConnection] = useState<SpectrumConnectionState>({
    kind: "connecting"
  });
  const frameRef = useRef<SpectrumFrameBuffers>(emptySpectrumBuffers());

  useEffect(() => {
    if (!enabled) {
      setConnection({ kind: "disconnected", reason: "visualiser disabled" });
      return;
    }
    const diag = getSpectrumDiag();
    if (typeof WebSocket === "undefined") {
      diag.wsState = "error";
      setConnection({ kind: "error", reason: "WebSocket unavailable" });
      return;
    }

    const ownsTransport = sharedTransport === null;
    const transport =
      sharedTransport ?? new WsTransport({ url: frameworkUrl() });
    let cancelled = false;
    diag.wsState = "connecting";

    const handleHappening = (raw: unknown): void => {
      if (cancelled) return;
      diag.subEventCount += 1;
      const ok = decodeSpectrumFrameHappeningInto(raw, frameRef.current);
      if (ok) {
        diag.spectrumDecodeOk += 1;
        diag.lastAtMs = frameRef.current.atMs;
        diag.lastDecodeWallMs = Date.now();
        diag.lastClockDeltaMs = diag.lastDecodeWallMs - diag.lastAtMs;
        // Payload-truth shape: iterate the frame's own bins/channels.
        // Mono has no right channel, so maxR stays 0.
        const fb = frameRef.current;
        let maxL = 0;
        let maxR = 0;
        for (let i = 0; i < fb.bins; i++) {
          const l = fb.magnitudes[i * fb.channels];
          if (l > maxL) maxL = l;
          if (fb.channels === 2) {
            const r = fb.magnitudes[i * fb.channels + 1];
            if (r > maxR) maxR = r;
          }
        }
        diag.lastFrameMaxL = maxL;
        diag.lastFrameMaxR = maxR;
      } else {
        diag.spectrumDecodeReject += 1;
      }
    };

    const seedFrame = async (): Promise<void> => {
      const initial = await pluginRequest(
        transport,
        SPECTRUM_SHELF,
        SPECTRUM_READ_VERB,
        { v: PAYLOAD_VERSION }
      );
      if (cancelled || initial.error !== undefined) return;
      if (decodeSpectrumFrameInto(initial.value, frameRef.current)) {
        diag.spectrumSeedOk += 1;
      } else {
        diag.spectrumSeedReject += 1;
      }
    };

    if (!ownsTransport) {
      const attach = attachSharedHappenings(transport, {
        subscribePayload: ALLOW_SPECTRUM_PAYLOAD,
        onConnecting: (attempt) => {
          if (cancelled) return;
          if (attempt !== undefined) diag.wsAttempts = attempt;
          setConnection(
            attempt === undefined
              ? { kind: "connecting" }
              : { kind: "connecting", attempt }
          );
        },
        onConnected: () => {
          if (cancelled) return;
          diag.wsState = "connected";
          setConnection({ kind: "connected" });
        },
        onError: (_n, detail) => {
          if (cancelled) return;
          diag.wsState = "error";
          setConnection({ kind: "error", reason: spectrumConnectError(detail) });
        },
        isCancelled: () => cancelled,
        afterOpen: seedFrame,
        onHappening: handleHappening
      });
      return () => {
        cancelled = true;
        attach.stop();
      };
    }

    setConnection({ kind: "connecting" });
    const subAbort = new AbortController();
    let offHappening: (() => void) | undefined;
    void (async (): Promise<void> => {
      try {
        await connectWithRetry(
          transport,
          (attempt) => {
            if (!cancelled) {
              diag.wsAttempts = attempt;
              setConnection({ kind: "connecting", attempt });
            }
          },
          () => cancelled
        );
        if (cancelled) return;
        diag.wsState = "connected";
        setConnection({ kind: "connected" });
        await seedFrame();
        if (cancelled) return;
        offHappening = transport.onHappening((f) => handleHappening(f.happening));
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            ALLOW_SPECTRUM_PAYLOAD,
            { signal: subAbort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              handleHappening(event);
            }
          } catch {
            // ended
          }
        })();
      } catch (err) {
        if (cancelled) return;
        diag.wsState = "error";
        const detail = err instanceof Error ? err.message : String(err);
        setConnection({ kind: "error", reason: spectrumConnectError(detail) });
      }
    })();

    return () => {
      cancelled = true;
      subAbort.abort();
      if (offHappening !== undefined) offHappening();
      void transport.close();
    };
  }, [enabled, sharedTransport]);

  return { connection, frameRef };
}
