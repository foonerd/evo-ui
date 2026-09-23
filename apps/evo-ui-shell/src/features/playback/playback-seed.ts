// Boot seed for now_playing. The subject is transition-only: a
// failed first get_now_playing with no retry leaves the glass on
// Nothing playing while audio is already running, until the next
// transport change.

export const PLAYBACK_NOW_PLAYING_SEED_ATTEMPTS = 2;
export const PLAYBACK_NOW_PLAYING_SEED_RETRY_MS = 1_500;

/** Retry only a failed seed. A successful idle decode (nothing
 *  playing) is the truth and must not be polled. */
export function playbackNowPlayingSeedShouldRetry(
  hasError: boolean,
  attempt: number,
  maxAttempts: number = PLAYBACK_NOW_PLAYING_SEED_ATTEMPTS
): boolean {
  return hasError && attempt < maxAttempts;
}
