// One in-flight operator-password card. A second acquire joins the
// same sitting instead of replacing the waiter — replacing orphans
// the first promise and hangs that dispatch.

export type StepUpAcquireResolve = (token: string | null) => void;

export function createStepUpAcquireLane(): {
  readonly open: boolean;
  enqueue: (resolve: StepUpAcquireResolve) => boolean;
  settle: (token: string | null) => void;
} {
  const waiters: StepUpAcquireResolve[] = [];
  return {
    get open() {
      return waiters.length > 0;
    },
    enqueue(resolve) {
      waiters.push(resolve);
      return waiters.length === 1;
    },
    settle(token) {
      const all = waiters.splice(0);
      for (const resolve of all) resolve(token);
    }
  };
}
