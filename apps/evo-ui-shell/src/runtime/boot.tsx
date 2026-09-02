// Schema-first boot path. Connects to the framework's HTTPS + WS
// substrate, fetches the initial admitted-stocking + shelf-contract
// + widget-kind snapshot, opens the central happenings subscription
// that drives every reactive consumer in the shell, hooks the hash
// router, and feeds the renderer through the reactive stores +
// composition resolver.
//
// Atomic-sync invariant: every Happening variant tied to a
// subject + revision routes through one mechanism — the
// `HappeningsDispatcher` — not five per-feature hand-coded paths.
// Settings, themes, transport state, queue, network, plugin
// lifecycle all share this one subscription.

import type { ReadonlySignal, Signal } from "@preact/signals";

import { EvoClient } from "../sdk/client";
import { HttpTransport } from "./http-transport";
import { WsTransport } from "./ws-transport";
import {
  decodeUiSnapshot,
  StockingStore,
  type UiSnapshot,
} from "./stockings";
import {
  createBreakpointSignal,
  createCompositionComputed,
  type ResolvedShelf,
} from "./composition";
import { createRouter, type Route } from "./router";
import {
  buildTier1Registry,
  registerAudioReferenceKinds,
  WidgetRegistry,
} from "./widgets/registry";
import { SdkVerbDispatcher, type VerbDispatcher } from "./input/dispatcher";
import { mountKeyboardBindings } from "./input/keyboard";
import { mountGestureBindings } from "./input/gesture";
import { SubjectStore } from "./subjects";
import { HappeningsDispatcher } from "./happenings";

/** Runtime handle returned by {@link bootRuntime}. */
export interface Runtime {
  client: EvoClient;
  ws: WsTransport;
  http: HttpTransport;
  stockings: StockingStore;
  subjects: SubjectStore;
  happenings: HappeningsDispatcher;
  widgets: WidgetRegistry;
  /** Multi-modal verb dispatcher. Voice / keyboard / gesture / touch / IR all route through this surface. */
  verbs: VerbDispatcher;
  /** Resolved composition keyed by shelf id. Reactive. */
  composition: ReadonlySignal<{ readonly [id: string]: ResolvedShelf }>;
  /** Current hash-route. Reactive. */
  route: Signal<Route>;
  navigate(target: Route): void;
  /** Close all transports + cancel active subscriptions. */
  shutdown(): Promise<void>;
}

/** Configuration for the runtime boot path. */
export interface RuntimeConfig {
  /** Base URL for HTTP dispatch. Defaults to the page origin. */
  baseUrl?: string;
  /** WebSocket URL. Defaults to `wss://<host>/api/v1/ws` (or `ws://` on plain HTTP). */
  wsUrl?: string;
  /** Bearer token for authentication. The bootstrap token shipped at first boot or an operator-issued token. */
  bearerToken?: string;
}

/**
 * Bring the runtime online:
 *
 * 1. Construct HTTP + WS transports.
 * 2. Open the WS connection so the server-pushed happenings
 *    fan-out starts immediately.
 * 3. Call `describe_ui_stockings` to seed the snapshot (shelves +
 *    widget kinds + admitted entries in one round trip).
 * 4. Open the explicit `subscribe_happenings` subscription so the
 *    `since` cursor governs replay on reconnect.
 * 5. Hook the central happenings dispatcher to both surfaces;
 *    every variant routes through it.
 * 6. Stand up the breakpoint signal + composition resolver.
 * 7. Stand up the hash router.
 *
 * Returns a populated {@link Runtime}.
 */
export async function bootRuntime(cfg: RuntimeConfig = {}): Promise<Runtime> {
  const http = new HttpTransport({
    baseUrl: cfg.baseUrl,
    bearerToken: cfg.bearerToken,
  });
  const ws = new WsTransport({
    url: cfg.wsUrl,
    bearerToken: cfg.bearerToken,
  });

  // Compose: read ops route through HTTP (cacheable, debuggable);
  // subscription ops route through WS. Other dispatches default to
  // WS so a single connection carries the bulk of the traffic.
  const transport = {
    dispatch: (op: string, payload: Record<string, unknown>, opts?: unknown) => {
      if (
        op.startsWith("describe_") ||
        op.startsWith("list_") ||
        op.startsWith("get_")
      ) {
        return http.dispatch(op, payload, opts as never);
      }
      return ws.dispatch(op, payload, opts as never);
    },
    subscribe: (op: string, payload: Record<string, unknown>, opts?: unknown) =>
      ws.subscribe(op, payload, opts as never),
  };

  const client = new EvoClient(transport);
  await ws.connect();

  const stockings = new StockingStore();
  const widgets = buildTier1Registry();
  registerAudioReferenceKinds(widgets);
  const subjects = new SubjectStore();
  const happenings = new HappeningsDispatcher(subjects);

  // Seed the snapshot via the canonical describe wire-op. The
  // response shape is additive — old servers without `shelves` /
  // `widget_kinds` return only `entries`, and the decoder falls
  // through to empty maps.
  const initial = await client.plugins.describeUiStockings();
  if (initial.error !== undefined) {
    throw new Error(
      `describe_ui_stockings refused: ${initial.error.code}: ${initial.error.message}`,
    );
  }
  const snapshot: UiSnapshot = decodeUiSnapshot(initial.value);
  stockings.replaceAll(snapshot);

  // Subscribe to the framework's happenings bus. The dispatcher
  // routes every variant: SubjectStateChanged / SubjectForgotten /
  // SubjectMerged / SubjectSplit / UiShelfChanged / everything
  // else (`other` records into the recent-ring for observability).
  // `initialSince=0` requests no replay on first connect; the
  // server begins streaming live events. On reconnect through the
  // WsTransport's reconnect path the runtime can call `attach`
  // again with the current cursor for replay.
  const detachHappenings = happenings.attach(ws, client, 0);

  // Stocking-specific reactive update for `UiShelfChanged`. The
  // central dispatcher records the seq; the per-shelf
  // re-decode happens here with the full envelope context the
  // composition resolver needs.
  const offShelfChange = ws.onHappening((frame) => {
    const ev = frame.happening;
    if (!isObject(ev)) return;
    const variant = stringField(ev, "kind") ?? stringField(ev, "variant");
    if (variant !== "ui_shelf_changed") return;
    const shelfId = stringField(ev, "shelf_id") ?? stringField(ev, "shelfId");
    if (shelfId === null) return;
    const decoded = decodeUiSnapshot({
      entries: ev["stockings"] ?? [],
      shelves: snapshot.shelves,
      widget_kinds: snapshot.widgetKinds,
    });
    stockings.applyShelf(shelfId, decoded.stockings[shelfId] ?? []);
  });

  const breakpoint = createBreakpointSignal();
  const composition = createCompositionComputed(stockings.snapshot, breakpoint);
  const router = createRouter();

  // Multi-modal input substrate. Keyboard + gesture mount globally
  // on the document; voice is opt-in (the operator clicks the mic
  // affordance, which calls `startVoiceInput(verbs, ...)`). Every
  // modality routes through the shared `VerbDispatcher` so plugins
  // declaring verbs reach every input surface uniformly.
  const verbs = new SdkVerbDispatcher(client);
  const detachKeyboard = mountKeyboardBindings(verbs);
  const detachGesture = mountGestureBindings(verbs);

  return {
    client,
    ws,
    http,
    stockings,
    subjects,
    happenings,
    widgets,
    verbs,
    composition,
    route: router.route,
    navigate: router.navigate,
    shutdown: async () => {
      detachHappenings();
      offShelfChange();
      detachKeyboard();
      detachGesture();
      await ws.close();
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
