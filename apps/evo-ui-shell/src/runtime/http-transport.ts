// Schema-first HTTP transport for one-shot wire-op dispatch.
//
// Routes against the framework's HTTPS substrate at `/api/v1/<op_id>`.
// Read ops (`describe_*`, `list_*`, `get_*`) project to GET with the
// payload encoded as query parameters. Mutation ops project to POST /
// PUT / DELETE per the framework's method-derivation rule and carry
// the payload as a JSON body. Subscription class ops are NOT served by
// this transport; the WebSocket transport handles those.
//
// The transport implements the generated SDK's `Transport` interface
// so any `EvoClient` module call composes through it transparently.

import type { Transport } from "../sdk/transport";
import type { CallOpts, SubscribeOpts, WireOpResult } from "../sdk/types";

type HttpVerb = "GET" | "POST" | "PUT" | "DELETE";

/** Resolved per-op method + path + payload encoding. */
interface RestProjection {
  verb: HttpVerb;
  url: string;
  body: BodyInit | undefined;
}

/**
 * Configuration for the HTTP transport. `baseUrl` defaults to the
 * page origin so the shell loaded from the device serves traffic
 * against its own HTTPS listener; tests and dev-server proxies may
 * override.
 */
export interface HttpTransportConfig {
  baseUrl?: string;
  apiPrefix?: string;
  /** Bearer token presented on every request as `Authorization: Bearer ...`. */
  bearerToken?: string;
}

/**
 * Project a wire op id + payload onto the canonical REST shape the
 * framework's `evo-projection-rest` crate generates.
 *
 * Method-derivation rule: read-capability ops are GET; `delete_*` /
 * `cancel_*` / `revoke_*` / `remove_*` → DELETE; `put_*` / `set_*` →
 * PUT; everything else → POST. The shell uses identifier prefixes as
 * the proxy because the SDK module surface does not carry capability
 * metadata at runtime.
 */
function projectOp(
  op: string,
  payload: Record<string, unknown>,
  base: string,
  prefix: string,
): RestProjection {
  const verb = deriveVerb(op);
  const path = `${prefix}/${op}`;
  if (verb === "GET" || verb === "DELETE") {
    const qs = encodeQuery(payload);
    const url = qs.length === 0 ? `${base}${path}` : `${base}${path}?${qs}`;
    return { verb, url, body: undefined };
  }
  return {
    verb,
    url: `${base}${path}`,
    body: JSON.stringify(payload),
  };
}

function deriveVerb(op: string): HttpVerb {
  if (op.startsWith("describe_") || op.startsWith("list_") || op.startsWith("get_")) {
    return "GET";
  }
  if (
    op.startsWith("delete_") ||
    op.startsWith("cancel_") ||
    op.startsWith("revoke_") ||
    op.startsWith("remove_")
  ) {
    return "DELETE";
  }
  if (op.startsWith("put_") || op.startsWith("set_")) {
    return "PUT";
  }
  return "POST";
}

function encodeQuery(payload: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) {
      continue;
    }
    params.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  return params.toString();
}

/** HTTP transport implementing the SDK `Transport` interface. */
export class HttpTransport implements Transport {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private bearerToken: string | undefined;

  public constructor(cfg: HttpTransportConfig = {}) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    this.baseUrl = cfg.baseUrl ?? origin;
    this.apiPrefix = cfg.apiPrefix ?? "/api/v1";
    this.bearerToken = cfg.bearerToken;
  }

  /**
   * Update the bearer token presented on every request. Used after
   * step-up auth completes or when a fresh bootstrap token is minted.
   */
  public setBearerToken(token: string | undefined): void {
    this.bearerToken = token;
  }

  public async dispatch(
    op: string,
    payload: Record<string, unknown>,
    opts?: CallOpts,
  ): Promise<WireOpResult> {
    const { verb, url, body } = projectOp(op, payload, this.baseUrl, this.apiPrefix);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.bearerToken !== undefined) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    }
    if (opts?.stepUpToken !== undefined) {
      headers["X-Step-Up-Token"] = opts.stepUpToken;
    }
    const resp = await fetch(url, {
      method: verb,
      headers,
      body,
      signal: opts?.signal,
      credentials: "include",
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        error: {
          code: deriveErrorCode(resp.status),
          message:
            text.length > 0
              ? text
              : `HTTP ${resp.status} ${resp.statusText}`,
        },
      };
    }
    const text = await resp.text();
    if (text.length === 0) {
      return { value: undefined };
    }
    try {
      return { value: JSON.parse(text) };
    } catch (e) {
      return {
        error: {
          code: "parse_failed",
          message: `failed to parse response JSON: ${(e as Error).message}`,
        },
      };
    }
  }

  // HTTP transport refuses subscription class ops; the WebSocket
  // transport handles those. Returning a refusing iterator keeps the
  // type contract while making the misuse explicit.
  public subscribe(
    _op: string,
    _payload: Record<string, unknown>,
    _opts?: SubscribeOpts,
  ): AsyncIterable<unknown> {
    return {
      [Symbol.asyncIterator]: () => ({
        async next(): Promise<IteratorResult<unknown>> {
          throw new Error(
            "HttpTransport.subscribe is not supported; route subscription ops through WsTransport.",
          );
        },
      }),
    };
  }
}

function deriveErrorCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable_entity";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "internal_error";
  return "http_error";
}
