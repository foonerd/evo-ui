// Contract tests for the credential wire-op senders + list decoder.
// Fixtures are the exact documented shapes (framework credential
// wire-op response bodies).

import test from "node:test";
import assert from "node:assert/strict";
import { decodeCredentialListing } from "../../src/features/credentials/credential-decoders.ts";
import {
  credentialListKeys,
  credentialPut,
  credentialDelete,
  encodeCredentialValue,
  type CredentialDispatcher
} from "../../src/features/credentials/credential-ops.ts";
import type { WireOpResult } from "../../src/sdk/types.ts";

const PLUGIN = "org.evoframework.metadata.online";

// --- decoder -------------------------------------------------------

test("decodeCredentialListing reads the documented entry shape", () => {
  const l = decodeCredentialListing({
    credential_listing: true,
    plugin_id: PLUGIN,
    entries: [
      {
        key_hash: "8f2c",
        display_name: "Last.fm API key",
        expires_at_ms: null,
        uninstall_policy: "preserve_for_reinstall",
        created_at_ms: 1721749200000,
        updated_at_ms: 1721749200000
      }
    ]
  });
  assert.equal(l?.pluginId, PLUGIN);
  assert.equal(l?.entries.length, 1);
  assert.equal(l?.entries[0].keyHash, "8f2c");
  assert.equal(l?.entries[0].displayName, "Last.fm API key");
  assert.equal(l?.entries[0].uninstallPolicy, "preserve_for_reinstall");
  assert.equal(l?.entries[0].expiresAtMs, null);
  assert.equal(l?.entries[0].updatedAtMs, 1721749200000);
});

test("empty / absent entries decode to an empty listing (fresh install)", () => {
  assert.deepEqual(decodeCredentialListing({ plugin_id: PLUGIN, entries: [] }), {
    pluginId: PLUGIN,
    entries: []
  });
  assert.deepEqual(decodeCredentialListing({ plugin_id: PLUGIN }), {
    pluginId: PLUGIN,
    entries: []
  });
});

test("a row without key_hash is dropped, unknown policy -> other", () => {
  const l = decodeCredentialListing({
    plugin_id: PLUGIN,
    entries: [
      { display_name: "no hash" },
      { key_hash: "aa", uninstall_policy: "banana" }
    ]
  });
  assert.equal(l?.entries.length, 1);
  assert.equal(l?.entries[0].uninstallPolicy, "other");
});

test("decodeCredentialListing rejects a non-object / missing plugin_id", () => {
  assert.equal(decodeCredentialListing(null), null);
  assert.equal(decodeCredentialListing({ entries: [] }), null);
});

// --- senders -------------------------------------------------------

function fake(result: WireOpResult): {
  d: CredentialDispatcher;
  calls: Array<{ op: string; payload: Record<string, unknown> }>;
} {
  const calls: Array<{ op: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    d: {
      dispatch(op, payload) {
        calls.push({ op, payload });
        return Promise.resolve(result);
      }
    }
  };
}

test("encodeCredentialValue is standard PADDED base64 of the UTF-8 bytes", () => {
  assert.equal(encodeCredentialValue("abc123"), "YWJjMTIz");
  // padded (ends with '=' where the length demands it)
  assert.equal(encodeCredentialValue("key"), "a2V5");
  assert.equal(encodeCredentialValue("ab"), "YWI=");
});

test("credentialPut sends the right op + payload and returns the key_hash", async () => {
  const { d, calls } = fake({ value: { credential_stored: true, plugin_id: PLUGIN, key_hash: "b8dca2" } });
  const r = await credentialPut(d, {
    pluginId: PLUGIN,
    key: "lastfm_api_key",
    value: "SECRET",
    displayName: "Last.fm API key"
  });
  assert.equal(r.ok, true);
  assert.equal(calls[0].op, "credential_put");
  assert.equal(calls[0].payload["plugin_id"], PLUGIN);
  assert.equal(calls[0].payload["key"], "lastfm_api_key");
  assert.equal(calls[0].payload["value_b64"], encodeCredentialValue("SECRET"));
  // default uninstall policy is preserve_for_reinstall
  assert.equal(calls[0].payload["uninstall_policy"], "preserve_for_reinstall");
  if (r.ok) assert.equal(r.value.keyHash, "b8dca2");
});

test("credentialPut surfaces the framework subclass on refusal", async () => {
  const { d } = fake({
    error: { code: "permission_denied", message: "needs write", subclass: "credentials_write_required" }
  } as WireOpResult);
  const r = await credentialPut(d, { pluginId: PLUGIN, key: "k", value: "v" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.subclass, "credentials_write_required");
});

test("credentialListKeys decodes the listing on success", async () => {
  const { d } = fake({
    value: { credential_listing: true, plugin_id: PLUGIN, entries: [{ key_hash: "aa", display_name: "X" }] }
  });
  const r = await credentialListKeys(d, PLUGIN);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.entries[0].displayName, "X");
});

test("credentialDelete sends the op and reports ok", async () => {
  // The vault is write-only: the raw key name is never emitted to the
  // UI, so delete is keyed by the opaque key_hash (the id
  // credential_list_keys returns), NOT the raw key name.
  const KEY_HASH = "8f2c1d";
  const { d, calls } = fake({ value: { credential_deleted: true, plugin_id: PLUGIN, key_hash: KEY_HASH } });
  const r = await credentialDelete(d, PLUGIN, KEY_HASH);
  assert.equal(r.ok, true);
  assert.equal(calls[0].op, "credential_delete");
  assert.equal(calls[0].payload["plugin_id"], PLUGIN);
  assert.equal(calls[0].payload["key_hash"], KEY_HASH);
});
