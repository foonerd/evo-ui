import test from "node:test";
import assert from "node:assert/strict";
import { shouldReconcileFromEvent } from "../../src/core/reconcile-policy.ts";
import { appendCommandLogEntry } from "../../src/core/command-log.ts";

test("reconcile policy maps domain events deterministically", () => {
  assert.equal(shouldReconcileFromEvent("playback", { event: "playback.state" }), true);
  assert.equal(shouldReconcileFromEvent("queue", { event: "playback.state" }), false);
  assert.equal(shouldReconcileFromEvent("browse", { event: "browse.changed" }), true);
  assert.equal(shouldReconcileFromEvent("browse", { event: "sync.lagged" }), true);
  assert.equal(shouldReconcileFromEvent("system", { event: "network.changed" }), true);
  assert.equal(shouldReconcileFromEvent("system", { event: "sync.lagged" }), true);
  assert.equal(shouldReconcileFromEvent("system", { event: "system.notice" }), false);
  assert.equal(shouldReconcileFromEvent("playback", { event: "network.changed" }), false);
  assert.equal(shouldReconcileFromEvent("queue", null), false);
});

test("appendCommandLogEntry prepends newest and respects max length", () => {
  const entries = appendCommandLogEntry(
    [],
    {
      domain: "playback",
      action: "play",
      success: true,
      detail: "request a1"
    },
    2
  );

  const next = appendCommandLogEntry(
    entries,
    {
      domain: "browse",
      action: "search",
      success: false,
      detail: "timeout"
    },
    2
  );

  const capped = appendCommandLogEntry(
    next,
    {
      domain: "system",
      action: "network-request",
      success: true,
      detail: "request a3"
    },
    2
  );

  assert.equal(capped.length, 2);
  assert.equal(capped[0].domain, "system");
  assert.equal(capped[1].domain, "browse");
});
