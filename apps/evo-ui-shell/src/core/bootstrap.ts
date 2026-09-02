import type { GatewayClient } from "./gateway-client";
import type { BootstrapResult } from "./types";
import { resolveBootstrapPhase } from "./bootstrap-policy.ts";

export async function runBootstrap(client: GatewayClient): Promise<BootstrapResult> {
  try {
    const health = await client.checkHealth();

    if (health.status === "down") {
      return {
        phase: "offline",
        health,
        capabilities: null,
        error: "Gateway reported down state",
        retryable: true
      };
    }

    const capabilities = await client.fetchCapabilities();
    const phase = resolveBootstrapPhase({ health, capabilities });

    return {
      phase,
      health,
      capabilities,
      error: null,
      retryable: false
    };
  } catch (error) {
    return {
      phase: "offline",
      health: null,
      capabilities: null,
      error: error instanceof Error ? error.message : "Bootstrap failed",
      retryable: true
    };
  }
}
