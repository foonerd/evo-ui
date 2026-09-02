// Playback connection chrome — renders HeartbeatPanel only when
// policy says the operator must be informed (restart / upgrade /
// disconnect / error). Healthy F5 "connecting" stays quiet.

import { HeartbeatPanel } from "../../app/components/HeartbeatPanel";
import type { PlaybackConnectionState } from "./usePlayback";
import type { NowPlaying } from "./now-playing-decoders";
import {
  shouldShowPlaybackConnectionPopup,
  playbackConnectionHeadline
} from "./playback-connection-policy";

export interface PlaybackConnectionChromeProps {
  connection: PlaybackConnectionState;
  /** Last-known / live now_playing. Presence means F5 can stay quiet. */
  nowPlaying: NowPlaying | null;
}

export {
  shouldShowPlaybackConnectionPopup,
  playbackConnectionHeadline
} from "./playback-connection-policy";

/** Renders the maintenance/degrade popup only when policy says so.
 *  minDuration applies — operator must perceive a real event. */
export function PlaybackConnectionChrome({
  connection,
  nowPlaying
}: PlaybackConnectionChromeProps) {
  const visible = shouldShowPlaybackConnectionPopup(connection, nowPlaying);
  return (
    <HeartbeatPanel
      visible={visible}
      headline={playbackConnectionHeadline(connection)}
      sublabel={
        connection.kind === "error" && connection.reason
          ? connection.reason
          : connection.kind === "disconnected" && connection.reason
            ? connection.reason
            : undefined
      }
    />
  );
}
