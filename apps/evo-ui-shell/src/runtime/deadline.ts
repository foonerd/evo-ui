// Hard-deadline primitives for the critical boot path.
//
// Player contract: usable exact-or-degraded shell within
// USABLE_SHELL_BUDGET_MS "no matter what" — p100 by construction.
// Every blocking step on the critical path is raced against a
// deadline; a miss yields a DEFINED outcome, never an unbounded wait.

/** Hard ceiling for time-to-usable-shell (exact or degraded). */
export const USABLE_SHELL_BUDGET_MS = 2000;

/** Single WS open attempt budget. */
export const DEFAULT_OPEN_DEADLINE_MS = 800;

/** Per seed-read budget (get_now_playing / get_stream_format).
 *  Seeds run in parallel and never gate the connected/degraded paint. */
export const DEFAULT_SEED_DEADLINE_MS = 800;

/** Critical-path connect attempts. Paired with open + backoff:
 *  800 + 200 + 800 = 1800ms < USABLE_SHELL_BUDGET_MS. */
export const CRITICAL_CONNECT_ATTEMPTS = 2;

/** Backoff between critical-path connect attempts. */
export const CRITICAL_BACKOFF_MS: readonly number[] = [200];

/** Pause before a background recovery reconnect after the critical
 *  budget has already produced an explicit error/degraded state. */
export const RECOVER_PAUSE_MS = 1000;

/** Wall-clock upper bound for critical connect → error/degraded. */
export function criticalConnectBudgetMs(
  openMs: number = DEFAULT_OPEN_DEADLINE_MS,
  attempts: number = CRITICAL_CONNECT_ATTEMPTS,
  backoff: readonly number[] = CRITICAL_BACKOFF_MS
): number {
  if (attempts <= 0) return 0;
  let total = openMs * attempts;
  for (let i = 0; i < attempts - 1; i += 1) {
    total += backoff[i] ?? backoff[backoff.length - 1] ?? 0;
  }
  return total;
}

/** An AbortSignal that aborts after `ms`, plus a `cancel()` to clear
 *  the timer when the guarded operation finished first. */
export function deadlineSignal(ms: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort(new Error(`deadline exceeded after ${ms}ms`));
  }, ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

export type DeadlineResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

/** Race `p` against `ms`. Does not cancel underlying work — pair
 *  with deadlineSignal when the operation must stop. */
export async function withDeadline<T>(
  p: Promise<T>,
  ms: number
): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const settled = p.then(
    (value): DeadlineResult<T> => ({ timedOut: false, value })
  );
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
