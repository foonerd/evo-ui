// Senders for the three online_providers wire ops. These are TOP-LEVEL
// framework ops (online_providers_list / online_providers_set_enabled /
// online_providers_set_priority), not shelf requests, so they dispatch
// by op name directly - same pattern as the credential ops.
//
// The store publishes each set on the framework's online-provider-config
// change bus, so plugin reactors re-resolve their view live: a
// set_enabled(false) removes the source on the next verb dispatch with
// no restart.

import type { WireOpResult } from "../../sdk/types";
import {
  decodeProviderListing,
  type ProviderListing
} from "./provider-decoders.ts";

/** Minimal transport surface these senders need (WsTransport satisfies
 *  it; tests inject a fake). */
export interface ProviderDispatcher {
  dispatch(
    op: string,
    payload: Record<string, unknown>
  ): Promise<WireOpResult>;
}

export type ProviderOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; subclass: string | null };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toFailure(error: unknown): {
  ok: false;
  message: string;
  subclass: string | null;
} {
  let message = "The provider operation was refused.";
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

/** List every registered online provider with enable + priority +
 *  credential presence (read:online_providers). */
export async function providersList(
  d: ProviderDispatcher
): Promise<ProviderOpResult<ProviderListing>> {
  const r = await d.dispatch("online_providers_list", {});
  if (r.error !== undefined) return toFailure(r.error);
  const listing = decodeProviderListing(r.value);
  if (listing === null) {
    return {
      ok: false,
      message: "The provider listing response was malformed.",
      subclass: null
    };
  }
  return { ok: true, value: listing };
}

/** Toggle one provider's enable flag (write:online_providers). Hot-
 *  applies via the change bus - no restart. */
export async function providersSetEnabled(
  d: ProviderDispatcher,
  providerId: string,
  enabled: boolean
): Promise<ProviderOpResult<null>> {
  const r = await d.dispatch("online_providers_set_enabled", {
    provider_id: providerId,
    enabled
  });
  if (r.error !== undefined) return toFailure(r.error);
  return { ok: true, value: null };
}

/** Set one provider's cascade priority (0 highest .. 999 lowest;
 *  write:online_providers). */
export async function providersSetPriority(
  d: ProviderDispatcher,
  providerId: string,
  priority: number
): Promise<ProviderOpResult<null>> {
  const clamped = Math.max(0, Math.min(999, Math.round(priority)));
  const r = await d.dispatch("online_providers_set_priority", {
    provider_id: providerId,
    priority: clamped
  });
  if (r.error !== undefined) return toFailure(r.error);
  return { ok: true, value: null };
}
