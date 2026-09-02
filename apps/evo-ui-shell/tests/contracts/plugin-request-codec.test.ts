// Contract tests for the plugin-request codec - the canonical
// routing path for plugin Respondent request types through the
// framework's `request` op.
//
// Regression guard for the root cause: plugin request types
// (`options.set_mixer_type`, ...) are dotted ids the framework
// rejects as flat wire ops; they must route through `request` with
// a base64-encoded payload, and the response is base64-encoded too.

import test from "node:test";
import assert from "node:assert/strict";
import {
  encodePluginRequest,
  decodePluginResponse,
  pluginRequest,
  type RequestDispatcher
} from "../../src/runtime/plugin-request-codec.ts";
import type { WireOpResult } from "../../src/sdk/types.ts";

// --- encodePluginRequest ----------------------------------------

test("encodePluginRequest produces the request-op body shape", () => {
  const body = encodePluginRequest("audio.options", "options.set_mixer_type", {
    v: 1,
    value: "hardware"
  });
  assert.equal(body.shelf, "audio.options");
  assert.equal(body.request_type, "options.set_mixer_type");
  assert.equal(typeof body.payload_b64, "string");
});

test("encodePluginRequest payload_b64 round-trips to the inner JSON", () => {
  const payload = { v: 1, value: "hw:CARD=DAC" };
  const body = encodePluginRequest("audio.options", "options.set_mixer_device", payload);
  // Decode the base64 the way the framework would.
  const json = Buffer.from(body.payload_b64, "base64").toString("utf-8");
  assert.deepEqual(JSON.parse(json), payload);
});

test("encodePluginRequest encodes a null/undefined payload as an empty object", () => {
  const body = encodePluginRequest("audio.options", "options.get_settings", undefined);
  const json = Buffer.from(body.payload_b64, "base64").toString("utf-8");
  assert.deepEqual(JSON.parse(json), {});
});

test("encodePluginRequest survives a UTF-8 payload round-trip", () => {
  // Device display names can carry non-ASCII; base64 must be
  // UTF-8 safe, not latin1-truncated.
  const payload = { v: 1, value: "Salon - hi-fi" };
  const body = encodePluginRequest("audio.options", "options.set_mixer_control", payload);
  const json = Buffer.from(body.payload_b64, "base64").toString("utf-8");
  assert.deepEqual(JSON.parse(json), payload);
});

// --- decodePluginResponse ---------------------------------------

test("decodePluginResponse decodes a well-formed { payload_b64 } envelope", () => {
  const inner = { v: 1, mixer_type: "hardware", startup_volume_percent: 30 };
  const value = {
    payload_b64: Buffer.from(JSON.stringify(inner), "utf-8").toString("base64")
  };
  const r = decodePluginResponse(value);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, inner);
});

test("decodePluginResponse fails explicitly on a non-object envelope", () => {
  for (const bad of [undefined, null, "x", 42, []]) {
    const r = decodePluginResponse(bad);
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    if (r.ok) return;
    assert.match(r.message, /not an object/);
  }
});

test("decodePluginResponse fails explicitly when payload_b64 is missing", () => {
  const r = decodePluginResponse({ some_other_field: "value" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /missing the payload_b64/);
});

test("decodePluginResponse fails explicitly on malformed base64", () => {
  const r = decodePluginResponse({ payload_b64: "!!!not base64!!!" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /not valid base64/);
});

test("decodePluginResponse fails explicitly when the decoded content is not JSON", () => {
  const value = {
    payload_b64: Buffer.from("this is not json", "utf-8").toString("base64")
  };
  const r = decodePluginResponse(value);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.message, /not valid JSON/);
});

// --- pluginRequest (composed with a fake dispatcher) ------------

/** Build a fake dispatcher that asserts the request-op shape and
 *  returns a canned WireOpResult. */
function fakeDispatcher(
  respond: (op: string, payload: Record<string, unknown>) => WireOpResult
): RequestDispatcher {
  return {
    dispatch: (op, payload) => Promise.resolve(respond(op, payload))
  };
}

test("pluginRequest dispatches the request op and returns the decoded inner value", async () => {
  const inner = { v: 1, status: "ok" };
  const transport = fakeDispatcher((op, payload) => {
    assert.equal(op, "request");
    assert.equal(payload["shelf"], "audio.options");
    assert.equal(payload["request_type"], "options.set_mixer_type");
    assert.equal(typeof payload["payload_b64"], "string");
    return {
      value: {
        payload_b64: Buffer.from(JSON.stringify(inner), "utf-8").toString(
          "base64"
        )
      }
    };
  });
  const result = await pluginRequest(transport, "audio.options", "options.set_mixer_type", {
    v: 1,
    value: "software"
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, inner);
});

test("pluginRequest passes a framework/plugin error through untouched", async () => {
  const transport = fakeDispatcher(() => ({
    error: { code: "permanent", message: "mixer-transition rolled back" }
  }));
  const result = await pluginRequest(transport, "audio.options", "options.set_mixer_type", {});
  assert.notEqual(result.error, undefined);
  if (result.error === undefined) return;
  assert.equal(result.error.code, "permanent");
  assert.match(result.error.message, /rolled back/);
});

test("pluginRequest surfaces a response-decode failure as an explicit error", async () => {
  // No silent fallback: a malformed success envelope becomes an
  // explicit plugin_response_decode error, not a degraded value.
  const transport = fakeDispatcher(() => ({
    value: { payload_b64: "!!!not base64!!!" }
  }));
  const result = await pluginRequest(transport, "audio.options", "options.get_settings", {});
  assert.notEqual(result.error, undefined);
  if (result.error === undefined) return;
  assert.equal(result.error.code, "plugin_response_decode");
  assert.match(result.error.message, /not valid base64/);
});

test("pluginRequest end-to-end: encode + dispatch + decode is loss-free", async () => {
  // The dispatcher echoes the request payload back as the response,
  // proving the full encode -> wire -> decode path round-trips.
  const transport = fakeDispatcher((_op, payload) => ({
    value: { payload_b64: payload["payload_b64"] as string }
  }));
  const sent = { v: 1, value: 47 };
  const result = await pluginRequest(transport, "audio.options", "options.set_max_volume", sent);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, sent);
});
