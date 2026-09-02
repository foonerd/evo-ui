import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCommandLog } from "../../src/core/command-log-stats.ts";
import type { CommandLogEntry } from "../../src/core/command-log.ts";

function entry(partial: Partial<CommandLogEntry>): CommandLogEntry {
  return {
    id: partial.id ?? "id",
    at: partial.at ?? Date.now(),
    domain: partial.domain ?? "system",
    action: partial.action ?? "noop",
    success: partial.success ?? true,
    detail: partial.detail ?? "ok"
  };
}

test("summarizeCommandLog returns zeroed counters for empty list", () => {
  assert.deepEqual(summarizeCommandLog([]), {
    total: 0,
    failures: 0,
    success: 0
  });
});

test("summarizeCommandLog counts successes and failures deterministically", () => {
  const stats = summarizeCommandLog([
    entry({ success: true, domain: "playback", action: "play" }),
    entry({ success: false, domain: "queue", action: "remove" }),
    entry({ success: true, domain: "browse", action: "search" })
  ]);

  assert.deepEqual(stats, {
    total: 3,
    failures: 1,
    success: 2
  });
});
