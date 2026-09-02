// Playback connection chrome policy (pure — no Preact).
//
// Popups (HeartbeatPanel) are REQUIRED when the backend is genuinely
// unavailable or recovering from restart / upgrade / maintenance —
// the operator must be told unambiguously what is happening.
//
// Popups are FORBIDDEN for a healthy hard-refresh: opening a socket
// while the track is already playing is not a maintenance event.
// Brief "connecting" with last-known (or no last-known yet) stays
// quiet; only sustained error / disconnect raises the panel.

import type { PlaybackConnectionState } from "./usePlayback";
import type { NowPlaying } from "./now-playing-decoders";

/** True when the connection state warrants an operator-facing popup. */
export function shouldShowPlaybackConnectionPopup(
  connection: PlaybackConnectionState,
  nowPlaying: NowPlaying | null
): boolean {
  // Healthy path / brief connect: never a maintenance popup.
  if (connection.kind === "connected") return false;
  if (connection.kind === "connecting") return false;

  // Real degrade: steward down, restart, upgrade, socket lost.
  // Always inform — even if last-known is still on screen.
  if (connection.kind === "error") return true;
  if (connection.kind === "disconnected") return true;

  void nowPlaying;
  return false;
}

export function playbackConnectionHeadline(
  connection: PlaybackConnectionState
): string {
  if (connection.kind === "error") {
    return "Playback service unavailable";
  }
  if (connection.kind === "disconnected") {
    return "Reconnecting to playback...";
  }
  return "Connecting to playback...";
}
