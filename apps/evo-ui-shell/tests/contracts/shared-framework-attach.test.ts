// Shared FrameworkTransport attach: one WebSocket, many features;
// stop() must not close the socket.

import test from "node:test";
import assert from "node:assert/strict";
import { WsTransport } from "../../src/runtime/ws-transport.ts";
import { attachSharedHappenings } from "../../src/runtime/shared-framework-attach.ts";
import { pluginRequest } from "../../src/runtime/plugin-request-codec.ts";

class ScriptedWebSocket {
  static constructions = 0;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  public readyState = ScriptedWebSocket.CONNECTING;
  public closed = false;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  public constructor(_url: string) {
    ScriptedWebSocket.constructions += 1;
    queueMicrotask(() => {
      this.readyState = ScriptedWebSocket.OPEN;
      for (const cb of this.listeners["open"] ?? []) cb({ type: "open" });
    });
  }

  public addEventListener(type: string, cb: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  public send(data: string): void {
    let frame: { frame_type?: string; request_id?: number };
    try {
      frame = JSON.parse(data) as typeof frame;
    } catch {
      return;
    }
    if (frame.frame_type === "request" && typeof frame.request_id === "number") {
      const inner = btoa(
        JSON.stringify({
          v: 1,
          items: [],
          length: 0,
          current_position: null
        })
      );
      const response = JSON.stringify({
        frame_type: "response",
        response_to: frame.request_id,
        outcome: { outcome: "ok", value: { payload_b64: inner } }
      });
      queueMicrotask(() => {
        for (const cb of this.listeners["message"] ?? []) {
          cb({ data: response });
        }
      });
    }
    if (frame.frame_type === "subscribe") {
      // ack is optional for this attach path; ignore
    }
  }

  public close(): void {
    this.closed = true;
    this.readyState = ScriptedWebSocket.CLOSED;
    for (const cb of this.listeners["close"] ?? []) cb({ type: "close" });
  }
}

test("spectrum allow-filter attach still leaves shared socket open", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  ScriptedWebSocket.constructions = 0;
  (globalThis as { WebSocket?: unknown }).WebSocket = ScriptedWebSocket;
  try {
    const { ALLOW_SPECTRUM_PAYLOAD } = await import(
      "../../src/runtime/happenings-filter.ts"
    );
    const transport = new WsTransport({
      url: "ws://test-spectrum-attach",
      openTimeoutMs: 500
    });
    await transport.connect();
    const attach = attachSharedHappenings(transport, {
      subscribePayload: ALLOW_SPECTRUM_PAYLOAD,
      onConnecting: () => undefined,
      onConnected: () => undefined,
      onError: () => undefined,
      isCancelled: () => false,
      afterOpen: async () => undefined,
      onHappening: () => undefined
    });
    await new Promise((r) => setTimeout(r, 40));
    attach.stop();
    assert.equal(transport.isOpen(), true);
    assert.equal(ScriptedWebSocket.constructions, 1);
    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});

test("two attaches share one WebSocket; stop does not close it", async () => {
  const saved = (globalThis as { WebSocket?: unknown }).WebSocket;
  ScriptedWebSocket.constructions = 0;
  (globalThis as { WebSocket?: unknown }).WebSocket = ScriptedWebSocket;
  try {
    const transport = new WsTransport({
      url: "ws://test-shared-attach",
      openTimeoutMs: 500
    });
    await transport.connect();
    assert.equal(ScriptedWebSocket.constructions, 1);
    assert.equal(transport.isOpen(), true);

    let aConnected = false;
    let bConnected = false;
    let aSeeded = false;
    let bSeeded = false;

    const a = attachSharedHappenings(transport, {
      onConnecting: () => undefined,
      onConnected: () => {
        aConnected = true;
      },
      onError: () => undefined,
      isCancelled: () => false,
      afterOpen: async () => {
        const r = await pluginRequest(transport, "audio.queue", "queue.get_queue", {
          v: 1
        });
        if (r.error === undefined) aSeeded = true;
      },
      onHappening: () => undefined
    });

    const b = attachSharedHappenings(transport, {
      onConnecting: () => undefined,
      onConnected: () => {
        bConnected = true;
      },
      onError: () => undefined,
      isCancelled: () => false,
      afterOpen: async () => {
        const r = await pluginRequest(
          transport,
          "audio.favourites",
          "favourites.get_favourites",
          { v: 1 }
        );
        if (r.error === undefined) bSeeded = true;
      },
      onHappening: () => undefined
    });

    await new Promise((r) => setTimeout(r, 80));
    assert.equal(aConnected, true);
    assert.equal(bConnected, true);
    assert.equal(aSeeded, true);
    assert.equal(bSeeded, true);
    assert.equal(ScriptedWebSocket.constructions, 1, "no second upgrade");

    a.stop();
    b.stop();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(transport.isOpen(), true, "stop must not close shared socket");

    await transport.close();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = saved;
  }
});
