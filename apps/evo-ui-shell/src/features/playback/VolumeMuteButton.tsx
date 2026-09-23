// Copyright (c) 2026 Just a Nerd
// SPDX-License-Identifier: Apache-2.0
// The mute glyph follows now_playing.muted, not the slider
// value. Muted is a red crossed speaker.

import { Volume2, VolumeX } from "lucide-preact";

/** Button class. The muted modifier is what turns the glyph red. */
export function volumeMuteButtonClass(muted: boolean): string {
  return muted
    ? "playback-volume-icon playback-volume-icon-muted"
    : "playback-volume-icon";
}

interface VolumeMuteButtonProps {
  muted: boolean;
  busy: boolean;
  size: number;
  ariaLabel: string;
  onClick: () => void;
}

export function VolumeMuteButton({
  muted,
  busy,
  size,
  ariaLabel,
  onClick
}: VolumeMuteButtonProps) {
  return (
    <button
      type="button"
      className={volumeMuteButtonClass(muted)}
      disabled={busy}
      aria-pressed={muted}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {muted ? <VolumeX size={size} /> : <Volume2 size={size} />}
    </button>
  );
}
