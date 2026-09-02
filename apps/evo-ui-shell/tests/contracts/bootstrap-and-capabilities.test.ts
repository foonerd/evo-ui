import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED_CAPABILITY_KEYS, getCapabilityStatus } from "../../src/core/feature-gates.ts";
import { runBootstrap } from "../../src/core/bootstrap.ts";
import { hasRequiredCapabilityGaps, resolveBootstrapPhase } from "../../src/core/bootstrap-policy.ts";
import type {
  CapabilitiesPayload,
  CapabilityStatus,
  HealthPayload
} from "../../src/core/types.ts";

function buildCapabilities(defaultStatus: CapabilityStatus): CapabilitiesPayload {
  return {
    version: 1,
    capabilities: Object.fromEntries(
      REQUIRED_CAPABILITY_KEYS.map((key) => [key, defaultStatus])
    ) as Record<string, CapabilityStatus>
  };
}

function createClientStub(params: {
  health?: HealthPayload;
  capabilities?: CapabilitiesPayload;
  throwOnHealth?: string;
  throwOnCapabilities?: string;
}) {
  return {
    async checkHealth() {
      if (params.throwOnHealth) {
        throw new Error(params.throwOnHealth);
      }
      return (
        params.health ?? {
          status: "ok",
          timestamp: new Date().toISOString()
        }
      );
    },
    async fetchCapabilities() {
      if (params.throwOnCapabilities) {
        throw new Error(params.throwOnCapabilities);
      }
      return params.capabilities ?? buildCapabilities("supported");
    }
  };
}

test("getCapabilityStatus returns missing when payload/key absent", () => {
  assert.equal(getCapabilityStatus(null, "playback.transport"), "missing");
  assert.equal(
    getCapabilityStatus(buildCapabilities("supported"), "unknown.feature"),
    "missing"
  );
});

test("runBootstrap returns offline when gateway health is down", async () => {
  const result = await runBootstrap(
    createClientStub({
      health: { status: "down", timestamp: new Date().toISOString() }
    }) as never
  );

  assert.equal(result.phase, "offline");
  assert.equal(result.retryable, true);
  assert.equal(result.capabilities, null);
});

test("runBootstrap returns degraded when required capability has gaps", async () => {
  const capabilities = buildCapabilities("supported");
  capabilities.capabilities["queue.crud"] = "partial";

  const result = await runBootstrap(
    createClientStub({
      health: { status: "ok", timestamp: new Date().toISOString() },
      capabilities
    }) as never
  );

  assert.equal(result.phase, "degraded");
  assert.equal(result.retryable, false);
  assert.equal(result.error, null);
});

test("runBootstrap returns ready when health is ok and required capabilities are supported", async () => {
  const result = await runBootstrap(
    createClientStub({
      health: { status: "ok", timestamp: new Date().toISOString() },
      capabilities: buildCapabilities("supported")
    }) as never
  );

  assert.equal(result.phase, "ready");
  assert.equal(result.retryable, false);
  assert.notEqual(result.capabilities, null);
});

test("runBootstrap returns offline retryable envelope on unexpected errors", async () => {
  const result = await runBootstrap(
    createClientStub({
      throwOnCapabilities: "capability endpoint timeout"
    }) as never
  );

  assert.equal(result.phase, "offline");
  assert.equal(result.retryable, true);
  assert.match(result.error ?? "", /capability endpoint timeout/);
});

test("hasRequiredCapabilityGaps detects partial/missing required keys", () => {
  const supported = buildCapabilities("supported");
  assert.equal(hasRequiredCapabilityGaps(supported), false);

  const partial = buildCapabilities("supported");
  partial.capabilities["playback.transport"] = "partial";
  assert.equal(hasRequiredCapabilityGaps(partial), true);

  const missing = buildCapabilities("supported");
  missing.capabilities["queue.crud"] = "missing";
  assert.equal(hasRequiredCapabilityGaps(missing), true);
});

test("resolveBootstrapPhase prioritizes health down and degrades on gaps", () => {
  const allSupported = buildCapabilities("supported");

  assert.equal(
    resolveBootstrapPhase({
      health: { status: "down", timestamp: new Date().toISOString() },
      capabilities: allSupported
    }),
    "offline"
  );

  assert.equal(
    resolveBootstrapPhase({
      health: { status: "degraded", timestamp: new Date().toISOString() },
      capabilities: allSupported
    }),
    "degraded"
  );

  const withGap = buildCapabilities("supported");
  withGap.capabilities["network.settings"] = "partial";
  assert.equal(
    resolveBootstrapPhase({
      health: { status: "ok", timestamp: new Date().toISOString() },
      capabilities: withGap
    }),
    "degraded"
  );

  assert.equal(
    resolveBootstrapPhase({
      health: { status: "ok", timestamp: new Date().toISOString() },
      capabilities: allSupported
    }),
    "ready"
  );
});
