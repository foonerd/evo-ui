import test from "node:test";
import assert from "node:assert/strict";
import {
  getStepUpRemainingSeconds,
  isStepUpSessionActive
} from "../../src/core/step-up-session.ts";

test("isStepUpSessionActive returns false for null or malformed sessions", () => {
  assert.equal(isStepUpSessionActive(null), false);
  assert.equal(
    isStepUpSessionActive({
      token: "t",
      principal: "evo",
      scope: "scope.system.admin",
      expires_at: "invalid"
    }),
    false
  );
});

test("isStepUpSessionActive returns true only before expiry", () => {
  const now = Date.parse("2026-05-08T12:00:00.000Z");
  const session = {
    token: "t",
    principal: "evo",
    scope: "scope.system.admin" as const,
    expires_at: "2026-05-08T12:05:00.000Z"
  };
  assert.equal(isStepUpSessionActive(session, now), true);
  assert.equal(isStepUpSessionActive(session, Date.parse("2026-05-08T12:06:00.000Z")), false);
});

test("getStepUpRemainingSeconds clamps at zero", () => {
  const session = {
    token: "t",
    principal: "evo",
    scope: "scope.system.admin" as const,
    expires_at: "2026-05-08T12:01:30.000Z"
  };
  const now = Date.parse("2026-05-08T12:01:00.000Z");
  assert.equal(getStepUpRemainingSeconds(session, now), 30);
  assert.equal(getStepUpRemainingSeconds(session, Date.parse("2026-05-08T12:02:00.000Z")), 0);
});
