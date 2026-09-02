// PluginLifecyclePanel - the plugin-lifecycle surface in Settings.
//
// Lists every admitted plugin with its lifecycle mode. A healthy
// plugin offers Reload (re-read after a config change); the reload
// outcome renders inline from the plugin_reload_dispatched
// happening. A degraded plugin instead shows its failure reason and
// a Restore button, which clears the degraded slot and re-admits -
// the degraded set is seeded from get_plugin_health and kept live
// by the plugin_degraded / plugin_restored happenings.

import { useState } from "preact/hooks";
import { LifeBuoy, RefreshCw } from "lucide-preact";
import { usePluginLifecycle } from "./usePluginLifecycle";
import {
  lifecycleModeLabel,
  pluginDegradedReasonMessage,
  shortPluginName
} from "./plugin-lifecycle-decoders";

export function PluginLifecyclePanel() {
  const {
    connection,
    plugins,
    reloadStates,
    degraded,
    restoring,
    reload,
    restore
  } = usePluginLifecycle();
  const [restoreError, setRestoreError] = useState<Record<string, string>>(
    {}
  );

  if (connection.kind === "error") {
    return (
      <p className="feature-hint">
        Could not reach the device to list plugins: {connection.reason}
      </p>
    );
  }
  if (connection.kind === "connecting") {
    return <p className="feature-hint">Loading plugins...</p>;
  }
  if (plugins.length === 0) {
    return (
      <p className="feature-hint">No plugins are admitted on this device.</p>
    );
  }

  const onRestore = async (name: string): Promise<void> => {
    setRestoreError((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    const r = await restore(name);
    if (!r.ok && r.message !== null) {
      const message = r.message;
      setRestoreError((prev) => ({ ...prev, [name]: message }));
    }
  };

  return (
    <div className="plugin-tile">
      <p className="feature-description settings-help">
        Every plugin admitted on this device, with its lifecycle mode.
        Reload re-reads a plugin after a configuration change. A
        degraded plugin shows Restore instead - it clears the failure
        state and re-admits the plugin.
      </p>
      <ul className="plugin-tile-list">
        {plugins.map((p) => {
          const st = reloadStates[p.name];
          const busy = st !== undefined && st.phase === "dispatching";
          const settled =
            st !== undefined && st.phase === "settled" && st.message !== null;
          const deg = degraded[p.name];
          const isDegraded = deg !== undefined;
          const isRestoring = restoring[p.name] === true;
          return (
            <li
              key={p.name}
              className={
                isDegraded
                  ? "plugin-tile-row plugin-tile-row-degraded"
                  : "plugin-tile-row"
              }
            >
              <span className="plugin-tile-text">
                <strong>{shortPluginName(p.name)}</strong>
                <span className="plugin-tile-meta">
                  {p.shelf}
                  {p.interactionKind !== "unknown"
                    ? ` - ${p.interactionKind}`
                    : ""}
                </span>
                {isDegraded ? (
                  <span
                    className="plugin-tile-outcome plugin-tile-outcome-warn"
                    role="status"
                  >
                    Degraded - {pluginDegradedReasonMessage(deg.reason)}
                  </span>
                ) : null}
                {restoreError[p.name] !== undefined ? (
                  <span
                    className="plugin-tile-outcome plugin-tile-outcome-warn"
                    role="alert"
                  >
                    {restoreError[p.name]}
                  </span>
                ) : null}
                {settled && !isDegraded ? (
                  <span
                    className={`plugin-tile-outcome plugin-tile-outcome-${st.tone}`}
                    role="status"
                  >
                    {st.message}
                  </span>
                ) : null}
              </span>
              <span
                className="plugin-tile-mode"
                title={`Lifecycle mode: ${lifecycleModeLabel(p.lifecycleMode)}`}
              >
                {lifecycleModeLabel(p.lifecycleMode)}
              </span>
              {isDegraded ? (
                <button
                  type="button"
                  className="plugin-tile-restore"
                  disabled={isRestoring}
                  onClick={() => void onRestore(p.name)}
                >
                  <LifeBuoy size={13} aria-hidden />
                  <span>{isRestoring ? "Restoring..." : "Restore"}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="plugin-tile-reload"
                  disabled={busy}
                  onClick={() => void reload(p.name)}
                >
                  <RefreshCw size={13} aria-hidden />
                  <span>{busy ? "Reloading..." : "Reload"}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
