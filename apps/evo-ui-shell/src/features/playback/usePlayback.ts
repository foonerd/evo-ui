// Live-playback state — ONE App-root store on the shared transport.
//
// React adapter over playback-session.ts. Seeds last-known from
// sessionStorage so F5 paints exact player state immediately; live
// get_now_playing reconciles. Connection popups are policy in
// playback-connection-chrome.tsx (quiet connecting, loud error).

import type { ComponentChildren } from "preact";
import { createContext, createElement } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "preact/hooks";
import {
  FrameworkTransportProvider,
  useFrameworkTransport
} from "../../runtime/framework-transport";
import {
  dispatchPlaybackVerb,
  refreshNowPlayingSeed,
  startPlaybackSession,
  type PlaybackSessionConnection
} from "./playback-session";
import {
  readLastNowPlaying,
  writeLastNowPlaying
} from "./now-playing-cache";
import type { NowPlaying } from "./now-playing-decoders";
import { startReanchorDelayMs } from "./playback-clock";
import type { StreamFormat } from "../audio/stream-format-decoders";

export type PlaybackConnectionKind =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface PlaybackConnectionState {
  kind: PlaybackConnectionKind;
  reason?: string;
  attempt?: number;
}

export type PlaybackVerbResult =
  | { ok: true }
  | { ok: false; message: string };

export interface PlaybackState {
  connection: PlaybackConnectionState;
  nowPlaying: NowPlaying | null;
  /** Wall-clock time (Date.now()) the current `nowPlaying` sample was
   *  observed - the one anchor time every progress clock reads. Null
   *  only while there is no sample. A cached sample restored on a hard
   *  refresh is stamped at restore time and reconciled by the seed. */
  nowPlayingObservedAtMs: number | null;
  streamFormat: StreamFormat | null;
  play: () => Promise<PlaybackVerbResult>;
  pause: () => Promise<PlaybackVerbResult>;
  resume: () => Promise<PlaybackVerbResult>;
  stop: () => Promise<PlaybackVerbResult>;
  next: () => Promise<PlaybackVerbResult>;
  previous: () => Promise<PlaybackVerbResult>;
  seek: (positionMs: number) => Promise<PlaybackVerbResult>;
  seekByDelta: (deltaMs: number) => Promise<PlaybackVerbResult>;
  setVolume: (volume: number) => Promise<PlaybackVerbResult>;
  setMute: (enabled: boolean) => Promise<PlaybackVerbResult>;
  setRepeat: (enabled: boolean) => Promise<PlaybackVerbResult>;
  setShuffle: (enabled: boolean) => Promise<PlaybackVerbResult>;
  setSingle: (enabled: boolean) => Promise<PlaybackVerbResult>;
  setConsume: (enabled: boolean) => Promise<PlaybackVerbResult>;
  refreshNowPlaying: () => Promise<PlaybackVerbResult>;
}

const PlaybackContext = createContext<PlaybackState | null>(null);

function toConnection(
  state: PlaybackSessionConnection
): PlaybackConnectionState {
  if (state.kind === "connecting") {
    return { kind: "connecting", attempt: state.attempt };
  }
  if (state.kind === "connected") return { kind: "connected" };
  if (state.kind === "disconnected") {
    return { kind: "disconnected", reason: state.reason };
  }
  return { kind: "error", reason: state.reason };
}

function usePlaybackController(): PlaybackState {
  const transport = useFrameworkTransport();
  const [connection, setConnection] = useState<PlaybackConnectionState>({
    kind: "connecting"
  });
  // The sample and the moment it was observed travel together: every
  // progress clock on the glass anchors on this one stamp.
  const [sample, setSample] = useState<{
    nowPlaying: NowPlaying | null;
    observedAtMs: number | null;
  }>(() => {
    const cached = readLastNowPlaying();
    return {
      nowPlaying: cached,
      observedAtMs: cached === null ? null : Date.now()
    };
  });
  const [streamFormat, setStreamFormat] = useState<StreamFormat | null>(null);
  const cancelledRef = useRef(false);
  // The last sample taken, for the start decision (a start is a playing
  // sample near the head of a track the previous sample was not already
  // playing), and the one pending re-anchor read a start schedules.
  const latestRef = useRef<NowPlaying | null>(sample.nowPlaying);
  const startReadRef = useRef<number | null>(null);

  const cancelStartRead = useCallback(() => {
    if (startReadRef.current !== null) {
      window.clearTimeout(startReadRef.current);
      startReadRef.current = null;
    }
  }, []);

  const takeSample = useCallback(
    (s: NowPlaying) => {
      latestRef.current = s;
      setSample({ nowPlaying: s, observedAtMs: Date.now() });
      writeLastNowPlaying(s);
    },
    []
  );

  useEffect(() => {
    cancelledRef.current = false;
    const session = startPlaybackSession(transport, {
      onConnection: (s) => {
        if (!cancelledRef.current) setConnection(toConnection(s));
      },
      onNowPlaying: (s) => {
        if (cancelledRef.current) return;
        const prev = latestRef.current;
        // A newer sample supersedes any read a start scheduled.
        cancelStartRead();
        takeSample(s);
        // First play of a track: the sample was taken when the verb
        // was, ahead of the audible start. One get_now_playing read
        // after the grace re-anchors every clock on what the warden
        // reports then. One read, on a start, never a cadence.
        const delay = startReanchorDelayMs(prev, s);
        if (delay !== null) {
          startReadRef.current = window.setTimeout(() => {
            startReadRef.current = null;
            void refreshNowPlayingSeed(transport).then((result) => {
              if (cancelledRef.current || !result.ok) return;
              takeSample(result.value);
            });
          }, delay);
        }
      },
      onStreamFormat: (s) => {
        if (!cancelledRef.current) setStreamFormat(s);
      },
      isCancelled: () => cancelledRef.current
    });
    return () => {
      cancelledRef.current = true;
      cancelStartRead();
      session.stop();
    };
  }, [transport, cancelStartRead, takeSample]);

  const dispatchVerb = useCallback(
    (requestType: string, envelope: Record<string, unknown>) =>
      dispatchPlaybackVerb(transport, requestType, envelope),
    [transport]
  );

  const play = useCallback(() => dispatchVerb("play", {}), [dispatchVerb]);
  const pause = useCallback(() => dispatchVerb("pause", {}), [dispatchVerb]);
  const resume = useCallback(() => dispatchVerb("resume", {}), [dispatchVerb]);
  const stop = useCallback(() => dispatchVerb("stop", {}), [dispatchVerb]);
  const next = useCallback(() => dispatchVerb("next", {}), [dispatchVerb]);
  const previous = useCallback(
    () => dispatchVerb("previous", {}),
    [dispatchVerb]
  );
  const seek = useCallback(
    (positionMs: number) =>
      dispatchVerb("seek", { position_ms: Math.round(positionMs) }),
    [dispatchVerb]
  );
  const seekByDelta = useCallback(
    (deltaMs: number) =>
      dispatchVerb("seek_by_delta", { delta_ms: Math.round(deltaMs) }),
    [dispatchVerb]
  );
  const setVolume = useCallback(
    (volume: number) =>
      dispatchVerb("set_volume", {
        volume: Math.min(100, Math.max(0, Math.round(volume)))
      }),
    [dispatchVerb]
  );
  const setMute = useCallback(
    (enabled: boolean) => dispatchVerb("set_mute", { enabled }),
    [dispatchVerb]
  );
  const setRepeat = useCallback(
    (enabled: boolean) => dispatchVerb("set_repeat", { enabled }),
    [dispatchVerb]
  );
  const setShuffle = useCallback(
    (enabled: boolean) => dispatchVerb("set_shuffle", { enabled }),
    [dispatchVerb]
  );
  const setSingle = useCallback(
    (enabled: boolean) => dispatchVerb("set_single", { enabled }),
    [dispatchVerb]
  );
  const setConsume = useCallback(
    (enabled: boolean) => dispatchVerb("set_consume", { enabled }),
    [dispatchVerb]
  );

  const refreshNowPlaying = useCallback(async (): Promise<PlaybackVerbResult> => {
    const result = await refreshNowPlayingSeed(transport);
    if (!result.ok) return result;
    cancelStartRead();
    takeSample(result.value);
    return { ok: true };
  }, [transport, cancelStartRead, takeSample]);

  return {
    connection,
    nowPlaying: sample.nowPlaying,
    nowPlayingObservedAtMs: sample.observedAtMs,
    streamFormat,
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    seek,
    seekByDelta,
    setVolume,
    setMute,
    setRepeat,
    setShuffle,
    setSingle,
    setConsume,
    refreshNowPlaying
  };
}

export function PlaybackProvider({
  children
}: {
  children: ComponentChildren;
}) {
  const state = usePlaybackController();
  return createElement(PlaybackContext.Provider, { value: state }, children);
}

export function PlayerShellProviders({
  children
}: {
  children: ComponentChildren;
}) {
  return createElement(
    FrameworkTransportProvider,
    null,
    createElement(PlaybackProvider, null, children)
  );
}

export function usePlayback(): PlaybackState {
  const ctx = useContext(PlaybackContext);
  if (ctx === null) {
    throw new Error(
      "usePlayback() requires <PlaybackProvider>; mount App under PlayerShellProviders."
    );
  }
  return ctx;
}
