import test from "node:test";
import assert from "node:assert/strict";
import { runCommandAction } from "../../src/core/command-action.ts";
import type { NewCommandLogEntry } from "../../src/core/command-log.ts";

test("runCommandAction logs success with custom detail and invokes onFinally", async () => {
  const logs: NewCommandLogEntry[] = [];
  let finallyCalled = false;
  let failureCalled = false;

  await runCommandAction({
    domain: "playback",
    action: "play",
    execute: async () => ({ ok: true, result: "req-123" as const }),
    toSuccessDetail: (result) => `request ${result}`,
    onFailure: () => {
      failureCalled = true;
    },
    onFinally: () => {
      finallyCalled = true;
    },
    onCommandLog: (entry) => logs.push(entry)
  });

  assert.equal(failureCalled, false);
  assert.equal(finallyCalled, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    domain: "playback",
    action: "play",
    success: true,
    detail: "request req-123"
  });
});

test("runCommandAction logs failure and invokes rollback/finally hooks", async () => {
  const logs: NewCommandLogEntry[] = [];
  let finallyCalled = false;
  let failureCalled = false;
  let failureMessage = "";

  await runCommandAction({
    domain: "queue",
    action: "remove",
    execute: async () => ({ ok: false, error: "remove failed" as const }),
    onFailure: (message) => {
      failureCalled = true;
      failureMessage = message;
    },
    onFinally: () => {
      finallyCalled = true;
    },
    onCommandLog: (entry) => logs.push(entry)
  });

  assert.equal(failureCalled, true);
  assert.equal(failureMessage, "remove failed");
  assert.equal(finallyCalled, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    domain: "queue",
    action: "remove",
    success: false,
    detail: "remove failed"
  });
});

test("runCommandAction handles thrown execute errors as failure telemetry", async () => {
  const logs: NewCommandLogEntry[] = [];
  let finallyCalled = false;
  let failureCalled = false;
  let failureMessage = "";

  await runCommandAction({
    domain: "system",
    action: "bootstrap",
    execute: async () => {
      throw new Error("unexpected throw");
    },
    onFailure: (message) => {
      failureCalled = true;
      failureMessage = message;
    },
    onFinally: () => {
      finallyCalled = true;
    },
    onCommandLog: (entry) => logs.push(entry)
  });

  assert.equal(failureCalled, true);
  assert.equal(failureMessage, "unexpected throw");
  assert.equal(finallyCalled, true);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    domain: "system",
    action: "bootstrap",
    success: false,
    detail: "unexpected throw"
  });
});
