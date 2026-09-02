// Senders for the three credential wire ops. These are TOP-LEVEL ops
// (credential_put / credential_delete / credential_list_keys), not
// shelf requests, so they dispatch by op name directly - not through
// pluginRequest.
//
// value_b64 is standard PADDED base64 of the raw UTF-8 bytes the
// operator typed (the framework rejects unpadded). The value never
// appears in cleartext on the wire after the put, and there is no
// credential_get - the vault is write-only from here.

import type { WireOpResult } from "../../sdk/types";
import {
  decodeCredentialListing,
  type CredentialListing,
  type UninstallPolicy
} from "./credential-decoders.ts";

/** Minimal transport surface these senders need. WsTransport satisfies
 *  it; tests inject a fake. */
export interface CredentialDispatcher {
  dispatch(
    op: string,
    payload: Record<string, unknown>
  ): Promise<WireOpResult>;
}

/** Explicit result: the failure carries the framework subclass
 *  (credentials_write_required / vault_unavailable / ...) so the UI can
 *  route (e.g. "pair again" vs "retry") and surface the not-configured
 *  call-to-action. Never a silent fallback. */
export type CredentialOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; subclass: string | null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Standard PADDED base64 of a UTF-8 string. */
export function encodeCredentialValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toFailure(error: unknown): {
  ok: false;
  message: string;
  subclass: string | null;
} {
  let message = "The credential operation was refused.";
  let subclass: string | null = null;
  if (isObject(error)) {
    if (typeof error["message"] === "string" && error["message"].length > 0) {
      message = error["message"];
    }
    const sc = error["subclass"] ?? error["code"];
    if (typeof sc === "string" && sc.length > 0) subclass = sc;
  }
  return { ok: false, message, subclass };
}

/** Enumerate a plugin's credential inventory (read:credentials). */
export async function credentialListKeys(
  d: CredentialDispatcher,
  pluginId: string
): Promise<CredentialOpResult<CredentialListing>> {
  const r = await d.dispatch("credential_list_keys", { plugin_id: pluginId });
  if (r.error !== undefined) return toFailure(r.error);
  const listing = decodeCredentialListing(r.value);
  if (listing === null) {
    return {
      ok: false,
      message: "The credential listing response was malformed.",
      subclass: null
    };
  }
  return { ok: true, value: listing };
}

export interface CredentialPutArgs {
  pluginId: string;
  key: string;
  /** The raw value the operator typed; encoded here, never logged. */
  value: string;
  displayName?: string;
  /** Default "preserve_for_reinstall" - the operator would rather not
   *  re-type a third-party key after a reinstall. */
  uninstallPolicy?: UninstallPolicy;
  expiresAtMs?: number | null;
}

/** Store (or overwrite) a credential (write:credentials). */
export async function credentialPut(
  d: CredentialDispatcher,
  args: CredentialPutArgs
): Promise<CredentialOpResult<{ keyHash: string | null }>> {
  const payload: Record<string, unknown> = {
    plugin_id: args.pluginId,
    key: args.key,
    value_b64: encodeCredentialValue(args.value),
    display_name: args.displayName ?? null,
    expires_at_ms: args.expiresAtMs ?? null,
    uninstall_policy: args.uninstallPolicy ?? "preserve_for_reinstall"
  };
  const r = await d.dispatch("credential_put", payload);
  if (r.error !== undefined) return toFailure(r.error);
  const keyHash =
    isObject(r.value) && typeof r.value["key_hash"] === "string"
      ? r.value["key_hash"]
      : null;
  return { ok: true, value: { keyHash } };
}

/** Remove a credential by its key_hash (write:credentials). key_hash is
 *  the opaque id credential_list_keys returns; credential_delete accepts
 *  it directly, so any entry is removable without the UI knowing the
 *  raw key name. Idempotent server-side. */
export async function credentialDelete(
  d: CredentialDispatcher,
  pluginId: string,
  keyHash: string
): Promise<CredentialOpResult<null>> {
  const r = await d.dispatch("credential_delete", {
    plugin_id: pluginId,
    key_hash: keyHash
  });
  if (r.error !== undefined) return toFailure(r.error);
  return { ok: true, value: null };
}
