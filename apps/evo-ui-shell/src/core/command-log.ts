export interface CommandLogEntry {
  id: string;
  at: number;
  domain: "playback" | "queue" | "browse" | "system";
  action: string;
  success: boolean;
  detail: string;
}

export type NewCommandLogEntry = Omit<CommandLogEntry, "id" | "at">;

export function appendCommandLogEntry(
  prev: CommandLogEntry[],
  entry: NewCommandLogEntry,
  maxEntries = 20
): CommandLogEntry[] {
  const nextEntry: CommandLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now()
  };

  return [nextEntry, ...prev].slice(0, maxEntries);
}
