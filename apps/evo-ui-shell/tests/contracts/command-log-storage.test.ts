import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCommandLogStorage,
  serializeCommandLogStorage
} from "../../src/core/command-log-storage.ts";
import type { CommandLogEntry } from "../../src/core/command-log.ts";

const SAMPLE_ENTRY: CommandLogEntry = {
  id: "id-1",
  at: 1,
  domain: "system",
  action: "bootstrap",
  success: true,
  detail: "ok"
};

test("parseCommandLogStorage returns empty for null/invalid payloads", () => {
  assert.deepEqual(parseCommandLogStorage(null), []);
  assert.deepEqual(parseCommandLogStorage("not-json"), []);
  assert.deepEqual(parseCommandLogStorage(JSON.stringify({})), []);
});

test("parseCommandLogStorage keeps only valid entries and respects max", () => {
  const raw = JSON.stringify([
    SAMPLE_ENTRY,
    { bad: "entry" },
    { ...SAMPLE_ENTRY, id: "id-2", at: 2, success: false },
    { ...SAMPLE_ENTRY, id: "id-3", at: 3, domain: "unknown" }
  ]);

  const parsed = parseCommandLogStorage(raw, 2);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "id-1");
  assert.equal(parsed[1].id, "id-2");
});

test("serializeCommandLogStorage truncates by max entries", () => {
  const serialized = serializeCommandLogStorage(
    [
      SAMPLE_ENTRY,
      { ...SAMPLE_ENTRY, id: "id-2", at: 2, detail: "second" }
    ],
    1
  );
  const parsed = JSON.parse(serialized) as CommandLogEntry[];
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "id-1");
});
