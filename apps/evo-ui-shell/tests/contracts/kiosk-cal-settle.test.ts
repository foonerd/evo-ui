// Contract: wizard reset / derive leave Preparing / Calculating.
// Run: node --experimental-strip-types --test tests/contracts/kiosk-cal-settle.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIOSK_CAL_WRITE_DEADLINE_MS,
  abortedKioskCalWrite,
  classifyKioskWrite,
  settleKioskCalWrite
} from "../../src/features/kiosk/osk-state.ts";

test("the deadline is a hard bound, not an open wait", () => {
  assert.equal(KIOSK_CAL_WRITE_DEADLINE_MS, 15_000);
  assert.ok(KIOSK_CAL_WRITE_DEADLINE_MS > 0);
});

test("an already-aborted signal settles as blocked without waiting", async () => {
  const ac = new AbortController();
  ac.abort();
  const hung = new Promise<{ ok: true }>(() => undefined);
  const res = await settleKioskCalWrite(hung, ac.signal);
  assert.deepEqual(res, abortedKioskCalWrite());
  assert.equal(classifyKioskWrite(res), "blocked");
});

test("an abort while the write is parked settles as blocked", async () => {
  const ac = new AbortController();
  const hung = new Promise<{ ok: true }>(() => undefined);
  const pending = settleKioskCalWrite(hung, ac.signal);
  ac.abort();
  const res = await pending;
  assert.deepEqual(res, abortedKioskCalWrite());
  assert.equal(classifyKioskWrite(res), "blocked");
});

test("a finished write wins over a later abort", async () => {
  const ac = new AbortController();
  const res = await settleKioskCalWrite(
    Promise.resolve({ ok: true as const }),
    ac.signal
  );
  assert.deepEqual(res, { ok: true });
  assert.equal(classifyKioskWrite(res), "ok");
});

test("a rejected write settles as blocked, not a hang", async () => {
  const ac = new AbortController();
  const res = await settleKioskCalWrite(
    Promise.reject(new Error("connection_closed")),
    ac.signal
  );
  assert.deepEqual(res, abortedKioskCalWrite());
  assert.equal(classifyKioskWrite(res), "blocked");
});
