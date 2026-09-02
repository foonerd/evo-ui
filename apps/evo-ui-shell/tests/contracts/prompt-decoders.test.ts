// Contract: user-interaction prompt wire shapes (Phase 1b).
// Envelope + PromptType decode grounded against the framework's
// list_user_interactions handler and the plugin SDK's
// PromptType / PromptResponse serde shapes (tag "kind",
// snake_case). Unknown kinds MUST decode to the newer-client
// fallback, never throw - that is an SDK-mandated consumer
// obligation.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeUserInteractions,
  encodeAnswer,
  encodeCancel
} from "../../src/features/prompts/prompt-decoders.ts";

const passwordPrompt = {
  plugin: "org.evoframework.network.shares",
  prompt: {
    prompt_id: "share-cred-1",
    prompt_type: { kind: "password", label: "Password for family_nas" }
  }
};

test("list envelope decodes password prompt", () => {
  const out = decodeUserInteractions({
    user_interactions: true,
    prompts: [passwordPrompt]
  });
  assert.ok(out !== null);
  assert.equal(out.length, 1);
  assert.equal(out[0].plugin, "org.evoframework.network.shares");
  assert.equal(out[0].promptId, "share-cred-1");
  assert.deepEqual(out[0].promptType, {
    kind: "password",
    label: "Password for family_nas"
  });
});

test("non-envelope shapes return null", () => {
  assert.equal(decodeUserInteractions(null), null);
  assert.equal(decodeUserInteractions({}), null);
  assert.equal(decodeUserInteractions({ user_interactions: true }), null);
});

test("select decodes options; empty options degrade to unknown", () => {
  const mk = (options: unknown) =>
    decodeUserInteractions({
      user_interactions: true,
      prompts: [
        {
          plugin: "p",
          prompt: {
            prompt_id: "s1",
            prompt_type: { kind: "select", label: "Pick", options }
          }
        }
      ]
    });
  const good = mk([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  assert.ok(good !== null);
  assert.equal(good[0].promptType.kind, "select");
  const bad = mk([]);
  assert.ok(bad !== null);
  assert.equal(bad[0].promptType.kind, "unknown");
});

test("unknown / future kinds decode to fallback, never throw", () => {
  const out = decodeUserInteractions({
    user_interactions: true,
    prompts: [
      {
        plugin: "p",
        prompt: {
          prompt_id: "x1",
          prompt_type: { kind: "external_redirect", url: "https://example.com" }
        }
      },
      {
        plugin: "p",
        prompt: { prompt_id: "x2", prompt_type: { kind: "multi_field", fields: [] } }
      }
    ]
  });
  assert.ok(out !== null);
  assert.equal(out.length, 2);
  assert.equal(out[0].promptType.kind, "unknown");
  assert.equal(out[1].promptType.kind, "unknown");
});

test("error_context and session_id carried through", () => {
  const out = decodeUserInteractions({
    user_interactions: true,
    prompts: [
      {
        plugin: "p",
        prompt: {
          prompt_id: "r1",
          prompt_type: { kind: "text", label: "Host" },
          error_context: "Gateway is not in the same subnet",
          session_id: "wifi-setup"
        }
      }
    ]
  });
  assert.ok(out !== null);
  assert.equal(out[0].errorContext, "Gateway is not in the same subnet");
  assert.equal(out[0].sessionId, "wifi-setup");
});

test("answer + cancel payloads match the wire contract", () => {
  const items = decodeUserInteractions({
    user_interactions: true,
    prompts: [passwordPrompt]
  });
  assert.ok(items !== null);
  const item = items[0];
  assert.deepEqual(encodeAnswer(item, { kind: "password", value: "s3cret" }), {
    plugin: "org.evoframework.network.shares",
    prompt_id: "share-cred-1",
    response: { kind: "password", value: "s3cret" }
  });
  assert.deepEqual(encodeCancel(item), {
    plugin: "org.evoframework.network.shares",
    prompt_id: "share-cred-1"
  });
});
