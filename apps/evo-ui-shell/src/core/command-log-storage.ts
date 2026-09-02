import type { CommandLogEntry } from "./command-log";

export const COMMAND_LOG_STORAGE_KEY = "evo-ui-shell.command-log";
const DEFAULT_MAX_ENTRIES = 20;
const KNOWN_COMMAND_DOMAINS = new Set(["playback", "queue", "browse", "system"]);

export function parseCommandLogStorage(
  raw: string | null,
  maxEntries = DEFAULT_MAX_ENTRIES
): CommandLogEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isCommandLogEntry)
      .slice(0, Math.max(0, maxEntries));
  } catch {
    return [];
  }
}

export function serializeCommandLogStorage(
  entries: CommandLogEntry[],
  maxEntries = DEFAULT_MAX_ENTRIES
): string {
  return JSON.stringify(entries.slice(0, Math.max(0, maxEntries)));
}

function isCommandLogEntry(value: unknown): value is CommandLogEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CommandLogEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.at === "number" &&
    typeof candidate.domain === "string" &&
    KNOWN_COMMAND_DOMAINS.has(candidate.domain) &&
    typeof candidate.action === "string" &&
    typeof candidate.success === "boolean" &&
    typeof candidate.detail === "string"
  );
}
