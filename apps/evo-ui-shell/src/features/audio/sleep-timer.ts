// sleep-timer - the options.set_sleep_timer payload and the field parse.
//
// One timer on audio.options: after `seconds` the player fades the global
// volume to silence over `fade_ms` and pauses. Both are whole numbers,
// zero or greater; anything else is never sent, and there is no cap on
// the glass. Cancel is the two zeros and nothing else. The timer is kept
// by the player in memory: it is not in the options settings and the
// glass never reads it back. This is not the between-track setting.

export type SleepTimerPayload = { seconds: number; fade_ms: number };

/** Cancel: { seconds: 0, fade_ms: 0 } and nothing else. */
export const SLEEP_TIMER_CANCEL: Readonly<SleepTimerPayload> = Object.freeze({ seconds: 0, fade_ms: 0 });

function wholeAndNotNegative(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** The payload, or null when either number is not a whole number zero
 *  or greater: nothing is sent. */
export function sleepTimerPayload(seconds: number, fadeMs: number): SleepTimerPayload | null {
  if (!wholeAndNotNegative(seconds) || !wholeAndNotNegative(fadeMs)) return null;
  return { seconds, fade_ms: fadeMs };
}

/** A field's text as a whole number zero or greater, or null - an empty
 *  field is not zero, and a sign, a point or an exponent is not whole. */
export function parseWholeNumber(raw: string): number | null {
  const s = raw.trim();
  if (!/^[0-9]+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
