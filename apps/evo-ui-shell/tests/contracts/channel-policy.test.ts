import test from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_CHANNELS, isDeliveryChannel } from "../../src/core/channel-policy.ts";

test("delivery channels expose expected order", () => {
  assert.deepEqual(DELIVERY_CHANNELS, ["alpha", "test", "production"]);
});

test("isDeliveryChannel validates allowed values", () => {
  assert.equal(isDeliveryChannel("alpha"), true);
  assert.equal(isDeliveryChannel("production"), true);
  assert.equal(isDeliveryChannel("stable"), false);
  assert.equal(isDeliveryChannel(""), false);
});
