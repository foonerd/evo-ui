// The one in-memory step-up sitting behind the one card.
//
// step_up_auth_verify answers the token and expires_at_ms (wall-clock
// milliseconds). The store keeps both. A token at or past its
// expires_at_ms is no sitting: getToken answers null on read, and a timer
// clears the sitting at that moment and tells every subscriber, so a gate
// that keyed on a live sitting falls without a reload. An answer with no
// expires_at_ms invents no expiry. Pure: no preact, no socket; the clock
// is injectable so the contract drives it.

export interface HeldSitting {
  token: string;
  expiresAtMs: number | null;
}

/** The token, or null when there is no sitting or it is at or past
 *  expires_at_ms. */
export function liveToken(sitting: HeldSitting | null, nowMs: number): string | null {
  if (sitting === null) return null;
  if (sitting.expiresAtMs !== null && nowMs >= sitting.expiresAtMs) return null;
  return sitting.token;
}

export interface SittingClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const WALL_CLOCK: SittingClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

// setTimeout holds a signed 32-bit delay; a longer wait re-arms.
const MAX_TIMER_MS = 2_147_483_647;

export interface StepUpSittingStore {
  getToken: () => string | null;
  /** Set or clear the sitting. Re-setting the token verify issued keeps
   *  its expiry; any other token carries none. Tells every subscriber. */
  setToken: (token: string | null) => void;
  /** Record what verify issued. The caller that acquired it sets it
   *  live with setToken, as before. */
  issue: (token: string, expiresAtMs: number | null) => void;
  subscribe: (listener: (token: string | null) => void) => () => void;
  /** Stop the expiry timer (unmount). The sitting itself stays. */
  dispose: () => void;
}

export function createStepUpSittingStore(clock: SittingClock = WALL_CLOCK): StepUpSittingStore {
  let held: HeldSitting | null = null;
  // The last sitting verify issued. Re-setting its token always carries
  // its expiry, even after the timer has cleared it, so a dead token is
  // never revived as one with no end.
  let issued: HeldSitting | null = null;
  let timer: unknown = null;
  const listeners = new Set<(token: string | null) => void>();

  const getToken = (): string | null => liveToken(held, clock.now());
  const notify = (): void => {
    const token = getToken();
    listeners.forEach((listener) => listener(token));
  };
  const disarm = (): void => {
    if (timer !== null) {
      clock.clearTimer(timer);
      timer = null;
    }
  };
  const arm = (): void => {
    disarm();
    if (held === null || held.expiresAtMs === null) return;
    const wait = Math.min(Math.max(0, held.expiresAtMs - clock.now()), MAX_TIMER_MS);
    timer = clock.setTimer(() => {
      timer = null;
      if (held !== null && getToken() === null) {
        held = null;
        notify();
        return;
      }
      arm();
    }, wait);
  };

  return {
    getToken,
    setToken: (token) => {
      if (token === null) {
        held = null;
      } else if (issued !== null && issued.token === token) {
        held = issued;
      } else if (held === null || held.token !== token) {
        held = { token, expiresAtMs: null };
      }
      arm();
      notify();
    },
    issue: (token, expiresAtMs) => {
      issued = { token, expiresAtMs };
      held = issued;
      arm();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(getToken());
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: disarm
  };
}
