// usePluginLifecycle - the hook behind the plugin-lifecycle
// Settings tile.
//
// Reads the admitted-plugin inventory via list_plugins (each entry
// carries its lifecycle_mode) and the degraded set via
// get_plugin_health, and exposes per-plugin reload and restore
// gestures. plugin_reload / plugin_restore are step_up:plugins_admin
// gated; on the LAN-trust tier the principal carries that scope
// implicitly, so a plain dispatch with no token admits (verified
// against the rig). Both dispatch acks are fire-and-forget; the real
// outcomes arrive on happenings - plugin_reload_dispatched for a
// reload, plugin_degraded / plugin_restored for the degraded set -
// which this hook correlates back to the plugin.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { WsTransport } from "../../runtime/ws-transport";
import { connectWithRetry } from "../../runtime/connect-retry";
import { DENY_SPECTRUM_PAYLOAD } from "../../runtime/happenings-filter";
import type { WireOpError } from "../../sdk/types";
import {
  decodePluginInventory,
  decodePluginHealth,
  decodePluginReloadEvent,
  decodePluginDegradedEvent,
  decodePluginRestoredEvent,
  pluginReloadOutcomeMessage,
  pluginReloadOutcomeTone,
  type PluginInventoryEntry,
  type PluginDegradedEntry,
  type PluginReloadTone
} from "./plugin-lifecycle-decoders";

/** Bound on the dispatched -> outcome wait. If no happening lands
 *  inside this window the row settles to a neutral message. */
const RELOAD_OUTCOME_BUDGET_MS = 5000;

/** Connection state of the plugin-lifecycle transport. */
export type PluginLifecycleConnection =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "error"; reason: string };

/** Per-plugin reload state. */
export interface PluginReloadState {
  /** dispatching: gesture sent, outcome not yet known.
   *  settled: a terminal message is available. */
  phase: "dispatching" | "settled";
  /** Operator-readable line. Null only while dispatching. */
  message: string | null;
  /** Tone for the settled message. */
  tone: PluginReloadTone;
}

/** Result of a restore dispatch - the ack only. The degraded slot
 *  clears separately when the plugin_restored happening arrives. */
export interface PluginRestoreResult {
  ok: boolean;
  /** Operator-readable line when ok is false. */
  message: string | null;
}

/** Public surface of the hook. */
export interface PluginLifecycleState {
  connection: PluginLifecycleConnection;
  /** Admitted plugins, sorted by name. */
  plugins: ReadonlyArray<PluginInventoryEntry>;
  /** Per-plugin reload state, keyed by canonical plugin name. An
   *  absent key means no reload was attempted this session. */
  reloadStates: Readonly<Record<string, PluginReloadState>>;
  /** Currently-degraded plugins, keyed by canonical plugin name.
   *  Seeded from get_plugin_health, kept live by the
   *  plugin_degraded / plugin_restored happenings. */
  degraded: Readonly<Record<string, PluginDegradedEntry>>;
  /** Plugin names with a restore gesture in flight. */
  restoring: Readonly<Record<string, boolean>>;
  /** Dispatch a reload for one plugin. Resolves once the gesture is
   *  accepted or refused; the outcome keeps flowing into
   *  reloadStates via the happening stream after that. */
  reload: (pluginName: string) => Promise<void>;
  /** Dispatch a restore for a degraded plugin. Resolves with the
   *  ack; the degraded slot clears when plugin_restored arrives. */
  restore: (pluginName: string) => Promise<PluginRestoreResult>;
}

function frameworkUrl(): string {
  if (typeof window === "undefined") return "ws://localhost/api/v1/ws";
  const override = window.localStorage.getItem("evo.framework.ws_url");
  if (override !== null && override.length > 0) return override;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

/** Map a plugin_reload dispatch error to an honest operator line. */
function humanisePluginReloadError(err: WireOpError): string {
  const sub = err.subclass ?? "";
  if (
    sub === "plugins_admin_not_granted" ||
    err.code === "permission_denied"
  ) {
    return "Reloading plugins needs the plugins-admin capability, which this session does not hold.";
  }
  if (sub === "plugin_lifecycle_coordinator_not_configured") {
    return "This device's framework build has no plugin-reload coordinator.";
  }
  return err.message.length > 0 ? err.message : "The reload request failed.";
}

/** Map a plugin_restore dispatch error to an honest operator line. */
function humanisePluginRestoreError(err: WireOpError): string {
  const sub = err.subclass ?? "";
  if (
    sub === "plugins_admin_not_granted" ||
    err.code === "permission_denied"
  ) {
    return "Restoring a plugin needs the plugins-admin capability, which this session does not hold.";
  }
  if (sub === "plugin_degraded_registry_not_configured") {
    return "This device's framework build has no plugin-degraded registry.";
  }
  return err.message.length > 0 ? err.message : "The restore request failed.";
}

export function usePluginLifecycle(): PluginLifecycleState {
  const [connection, setConnection] = useState<PluginLifecycleConnection>({
    kind: "connecting"
  });
  const [plugins, setPlugins] = useState<ReadonlyArray<PluginInventoryEntry>>(
    []
  );
  const [reloadStates, setReloadStates] = useState<
    Record<string, PluginReloadState>
  >({});
  const [degraded, setDegraded] = useState<
    Record<string, PluginDegradedEntry>
  >({});
  const [restoring, setRestoring] = useState<Record<string, boolean>>({});

  const transportRef = useRef<WsTransport | null>(null);
  // Per-plugin outcome-budget timers, cleared when the happening
  // lands, when the row settles, or on unmount.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const clearTimer = useCallback((pluginName: string): void => {
    const timer = timersRef.current.get(pluginName);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(pluginName);
    }
  }, []);

  // Settle a row from a happening - only when the operator is
  // actually waiting on it. A stray plugin_reload_dispatched (a
  // file-watcher reload, or another session's gesture) for a plugin
  // this session never reloaded is ignored.
  const settleFromHappening = useCallback(
    (pluginName: string, message: string, tone: PluginReloadTone): void => {
      setReloadStates((prev) => {
        const cur = prev[pluginName];
        if (cur === undefined || cur.phase !== "dispatching") return prev;
        return {
          ...prev,
          [pluginName]: { phase: "settled", message, tone }
        };
      });
      clearTimer(pluginName);
    },
    [clearTimer]
  );

  useEffect(() => {
    if (typeof WebSocket === "undefined") return undefined;
    let cancelled = false;
    const transport = new WsTransport({ url: frameworkUrl() });
    transportRef.current = transport;
    setConnection({ kind: "connecting" });
    const timers = timersRef.current;

    const handleHappening = (raw: unknown): void => {
      if (cancelled) return;
      const reloadEv = decodePluginReloadEvent(raw);
      if (reloadEv !== null) {
        settleFromHappening(
          reloadEv.plugin,
          pluginReloadOutcomeMessage(reloadEv.outcome),
          pluginReloadOutcomeTone(reloadEv.outcome)
        );
        return;
      }
      const degEv = decodePluginDegradedEvent(raw);
      if (degEv !== null) {
        setDegraded((prev) => ({
          ...prev,
          [degEv.plugin]: { plugin: degEv.plugin, reason: degEv.reason }
        }));
        return;
      }
      const resEv = decodePluginRestoredEvent(raw);
      if (resEv !== null) {
        setDegraded((prev) => {
          if (prev[resEv.plugin] === undefined) return prev;
          const next = { ...prev };
          delete next[resEv.plugin];
          return next;
        });
      }
    };

    const seed = async (): Promise<void> => {
      try {
        await connectWithRetry(
          transport,
          () => {
            if (!cancelled) setConnection({ kind: "connecting" });
          },
          () => cancelled
        );
        if (cancelled) return;
        setConnection({ kind: "connected" });
        const listed = await transport.dispatch("list_plugins", {});
        if (!cancelled && listed.error === undefined) {
          setPlugins(decodePluginInventory(listed.value));
        }
        if (cancelled) return;
        const health = await transport.dispatch("get_plugin_health", {});
        if (!cancelled && health.error === undefined) {
          const decoded = decodePluginHealth(health.value);
          const map: Record<string, PluginDegradedEntry> = {};
          for (const e of decoded.degraded) map[e.plugin] = e;
          setDegraded(map);
        }
        if (cancelled) return;
        const abort = new AbortController();
        void (async (): Promise<void> => {
          const stream = transport.subscribe(
            "subscribe_happenings",
            DENY_SPECTRUM_PAYLOAD,
            { signal: abort.signal }
          );
          try {
            for await (const event of stream) {
              if (cancelled) return;
              handleHappening(event);
            }
          } catch {
            // Subscription ended; transport reconnect re-establishes.
          }
        })();
        transport.onHappening((f) => handleHappening(f.happening));
      } catch (err) {
        if (cancelled) return;
        setConnection({
          kind: "error",
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    };
    void seed();

    return () => {
      cancelled = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      void transport.close();
      transportRef.current = null;
    };
  }, [settleFromHappening]);

  const reload = useCallback(
    async (pluginName: string): Promise<void> => {
      const transport = transportRef.current;
      if (transport === null) {
        setReloadStates((prev) => ({
          ...prev,
          [pluginName]: {
            phase: "settled",
            message: "Not connected to the device.",
            tone: "warn"
          }
        }));
        return;
      }
      clearTimer(pluginName);
      setReloadStates((prev) => ({
        ...prev,
        [pluginName]: { phase: "dispatching", message: null, tone: "info" }
      }));
      // Outcome budget: if the happening never lands, the row still
      // settles rather than spinning forever.
      timersRef.current.set(
        pluginName,
        setTimeout(() => {
          timersRef.current.delete(pluginName);
          setReloadStates((prev) => {
            const cur = prev[pluginName];
            if (cur === undefined || cur.phase !== "dispatching") return prev;
            return {
              ...prev,
              [pluginName]: {
                phase: "settled",
                message: "Reload dispatched.",
                tone: "info"
              }
            };
          });
        }, RELOAD_OUTCOME_BUDGET_MS)
      );
      // plugin_reload is step_up:plugins_admin gated; on the
      // LAN-trust tier a plain dispatch with no token admits.
      const result = await transport.dispatch("plugin_reload", {
        plugin_name: pluginName
      });
      if (result.error !== undefined) {
        clearTimer(pluginName);
        const message = humanisePluginReloadError(result.error);
        setReloadStates((prev) => ({
          ...prev,
          [pluginName]: { phase: "settled", message, tone: "warn" }
        }));
      }
      // On ok the row stays "dispatching" until the happening or the
      // budget timer settles it.
    },
    [clearTimer]
  );

  const restore = useCallback(
    async (pluginName: string): Promise<PluginRestoreResult> => {
      const transport = transportRef.current;
      if (transport === null) {
        return { ok: false, message: "Not connected to the device." };
      }
      setRestoring((prev) => ({ ...prev, [pluginName]: true }));
      // plugin_restore is step_up:plugins_admin gated; on the
      // LAN-trust tier a plain dispatch with no token admits. The
      // ack is fire-and-forget - the degraded slot clears when the
      // plugin_restored happening arrives.
      const result = await transport.dispatch("plugin_restore", {
        plugin_name: pluginName
      });
      setRestoring((prev) => {
        const next = { ...prev };
        delete next[pluginName];
        return next;
      });
      if (result.error !== undefined) {
        return { ok: false, message: humanisePluginRestoreError(result.error) };
      }
      return { ok: true, message: null };
    },
    []
  );

  return {
    connection,
    plugins,
    reloadStates,
    degraded,
    restoring,
    reload,
    restore
  };
}
