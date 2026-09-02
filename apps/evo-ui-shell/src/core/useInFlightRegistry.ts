import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { formatInFlightSummary } from "./in-flight-summary";

interface InFlightEntry {
  id: string;
  label: string;
  startedAt: number;
}

export function useInFlightRegistry() {
  const [entries, setEntries] = useState<InFlightEntry[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const start = useCallback((label: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEntries((prev) => [...prev, { id, label, startedAt: Date.now() }]);
    return id;
  }, []);

  const finish = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const run = useCallback(
    async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
      const id = start(label);
      try {
        return await operation();
      } finally {
        finish(id);
      }
    },
    [finish, start]
  );

  const summary = useMemo(() => {
    return formatInFlightSummary(entries.length);
  }, [entries.length]);

  useEffect(() => {
    if (entries.length === 0) {
      return;
    }
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [entries.length]);

  const entriesWithAge = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        ageSeconds: Math.max(0, Math.floor((nowMs - entry.startedAt) / 1000))
      })),
    [entries, nowMs]
  );

  return {
    entries: entriesWithAge,
    summary,
    run
  };
}
