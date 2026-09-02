import type { CommandLogEntry } from "./command-log";

export interface CommandLogStats {
  total: number;
  failures: number;
  success: number;
}

export function summarizeCommandLog(entries: CommandLogEntry[]): CommandLogStats {
  const total = entries.length;
  const failures = entries.filter((entry) => !entry.success).length;
  return {
    total,
    failures,
    success: total - failures
  };
}
