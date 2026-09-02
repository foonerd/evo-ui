import type { NewCommandLogEntry } from "./command-log.ts";

interface CommandActionParams<T> {
  domain: NewCommandLogEntry["domain"];
  action: string;
  execute: () => Promise<{ ok: true; result: T } | { ok: false; error: string }>;
  toSuccessDetail?: (result: T) => string;
  onFailure?: (errorMessage: string) => void;
  onFinally?: () => void;
  onCommandLog: (entry: NewCommandLogEntry) => void;
}

export async function runCommandAction<T>({
  domain,
  action,
  execute,
  toSuccessDetail,
  onFailure,
  onFinally,
  onCommandLog
}: CommandActionParams<T>): Promise<void> {
  try {
    const outcome = await execute();
    if (!outcome.ok) {
      onFailure?.(outcome.error);
      onCommandLog({
        domain,
        action,
        success: false,
        detail: outcome.error
      });
    } else {
      onCommandLog({
        domain,
        action,
        success: true,
        detail: toSuccessDetail?.(outcome.result) ?? `request ${String(outcome.result ?? "n/a")}`
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled command action failure";
    onFailure?.(message);
    onCommandLog({
      domain,
      action,
      success: false,
      detail: message
    });
  } finally {
    onFinally?.();
  }
}
