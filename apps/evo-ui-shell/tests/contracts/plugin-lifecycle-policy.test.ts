import test from "node:test";
import assert from "node:assert/strict";
import { canRemovePlugin, pluginPolicyHint } from "../../src/core/plugin-lifecycle-policy.ts";

test("canRemovePlugin blocks bundled and allows admitted plugins", () => {
  assert.equal(
    canRemovePlugin({
      plugin_id: "org.evo.bundled",
      name: "Bundled",
      source: "bundled",
      enabled: true,
      distribution_model: "bundled"
    }),
    false
  );
  assert.equal(
    canRemovePlugin({
      plugin_id: "org.evo.community",
      name: "Community",
      source: "community",
      enabled: true,
      distribution_model: "admitted"
    }),
    true
  );
});

test("pluginPolicyHint explains key policy outcomes", () => {
  assert.equal(
    pluginPolicyHint({
      plugin_id: "org.evo.bundled",
      name: "Bundled",
      source: "bundled",
      enabled: true,
      distribution_model: "bundled"
    }),
    "bundled plugin: remove blocked by policy"
  );
  assert.equal(
    pluginPolicyHint({
      plugin_id: "org.evo.self",
      name: "Self",
      source: "community",
      enabled: true,
      trust_class: "self_attested"
    }),
    "self-attested plugin: removal allowed with caution"
  );
});
