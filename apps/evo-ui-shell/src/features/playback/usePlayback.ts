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
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(() =>
    readLastNowPlaying()
  );
  const [streamFormat, setStreamFormat] = useState<StreamFormat | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const session = startPlaybackSession(transport, {
      onConnection: (s) => {
        if (!cancelledRef.current) setConnection(toConnection(s));
      },
      onNowPlaying: (s) => {
        if (cancelledRef.current) return;
        setNowPlaying(s);
        writeLastNowPlaying(s);
      },
      onStreamFormat: (s) => {
        if (!cancelledRef.current) setStreamFormat(s);
      },
      isCancelled: () => cancelledRef.current
    });
    return () => {
      cancelledRef.current = true;
      session.stop();
    };
  }, [transport]);

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
    setNowPlaying(result.value);
    writeLastNowPlaying(result.value);
    return { ok: true };
  }, [transport]);

  return {
    connection,
    nowPlaying,
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
