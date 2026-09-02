import { useEffect, useMemo, useState } from "preact/hooks";
import { CapabilityGate } from "../../app/components/CapabilityGate";
import { GatewayClient } from "../../core/gateway-client";
import type { CapabilityStatus, PluginAdminItemPayload, StepUpSessionPayload } from "../../core/types";
import { combineCapabilityStatuses } from "../../core/capability-status";
import { useAsyncAction } from "../../core/useAsyncAction";
import { runCommandAction } from "../../core/command-action";
import type { NewCommandLogEntry } from "../../core/command-log";
import { formatRequestDetail } from "../../core/request-id";
import { useOperationsState } from "./useOperationsState";
import { canRemovePlugin, pluginPolicyHint } from "../../core/plugin-lifecycle-policy";
import { getStepUpRemainingSeconds, isStepUpSessionActive } from "../../core/step-up-session";
import { canRunPrivilegedOperation, needsStepUpReauth } from "../../core/operations-authz";

interface OperationsSurfaceProps {
  logLevelStatus: CapabilityStatus;
  diagnosticsStatus: CapabilityStatus;
  updatesChannelStatus: CapabilityStatus;
  updatesCoreStatus: CapabilityStatus;
  updatesPluginsStatus: CapabilityStatus;
  pluginLifecycleStatus: CapabilityStatus;
  sshStatus: CapabilityStatus;
  client: GatewayClient;
  runInFlight: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  onCommandLog: (entry: NewCommandLogEntry) => void;
}

export function OperationsSurface({
  logLevelStatus,
  diagnosticsStatus,
  updatesChannelStatus,
  updatesCoreStatus,
  updatesPluginsStatus,
  pluginLifecycleStatus,
  sshStatus,
  client,
  runInFlight,
  onCommandLog
}: OperationsSurfaceProps) {
  const status = combineCapabilityStatuses([
    logLevelStatus,
    diagnosticsStatus,
    updatesChannelStatus,
    updatesCoreStatus,
    updatesPluginsStatus,
    pluginLifecycleStatus,
    sshStatus
  ]);
  const state = useOperationsState(client);
  const action = useAsyncAction();
  const [stepUpSession, setStepUpSession] = useState<StepUpSessionPayload | null>(null);
  const [sessionClockMs, setSessionClockMs] = useState(Date.now());
  const [requiresReauth, setRequiresReauth] = useState(false);

  useEffect(() => {
    if (status !== "missing") {
      void state.refresh();
    }
  }, [state.refresh, status]);

  useEffect(() => {
    if (!stepUpSession) {
      return;
    }
    const id = setInterval(() => setSessionClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stepUpSession]);

  const stepUpActive = useMemo(
    () => isStepUpSessionActive(stepUpSession, sessionClockMs),
    [stepUpSession, sessionClockMs]
  );
  const stepUpToken = stepUpActive ? stepUpSession?.token ?? null : null;
  const stepUpRemainingSeconds = getStepUpRemainingSeconds(stepUpSession, sessionClockMs);

  const runPrivilegedAction = async (params: {
    action: string;
    inFlightLabel: string;
    execute: (token: string) => Promise<string>;
    successPrefix: string;
    onFinally?: () => void;
  }) => {
    if (!stepUpToken) {
      return;
    }
    await runCommandAction({
      domain: "system",
      action: params.action,
      execute: () =>
        action.run(
          () => runInFlight(params.inFlightLabel, () => params.execute(stepUpToken)),
          (result) => formatRequestDetail(params.successPrefix, result)
        ),
      onFailure: (message) => {
        if (needsStepUpReauth(message)) {
          setStepUpSession(null);
          setRequiresReauth(true);
        }
      },
      onFinally: params.onFinally,
      onCommandLog
    });
  };

  const plugins = state.plugins?.items ?? [];

  return (
    <CapabilityGate
      title="Operations & Admin"
      status={status}
      description="Maintenance, update channels, plugin lifecycle, and SSH controls."
      partialHint="Privileged operations require active step-up session and policy checks."
    >
      <div className="browse-grid">
        <div className="queue-state">
          <strong>Log level:</strong> {state.maintenance?.log_level ?? "n/a"}
        </div>
        <div className="queue-state">
          <strong>SSH:</strong> {state.ssh?.enabled ? "enabled" : "disabled"}
        </div>
      </div>
      <div className="queue-state">
        <strong>Step-up:</strong>{" "}
        {stepUpActive ? `active (${stepUpRemainingSeconds}s remaining)` : "required"}
      </div>
      <div className="browse-grid">
        <div className="queue-state">
          <strong>Core channel:</strong> {state.updates?.channels.core ?? "n/a"} | pending{" "}
          {state.updates?.pending.core ?? 0}
        </div>
        <div className="queue-state">
          <strong>Plugins channel:</strong> {state.updates?.channels.plugins ?? "n/a"} | pending{" "}
          {state.updates?.pending.plugins ?? 0}
        </div>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={action.loading || status === "missing"}
          onClick={() => {
            void runCommandAction({
              domain: "system",
              action: "admin-step-up",
              execute: () =>
                action.run(
                  () => runInFlight("operations:step-up", () => client.stepUpAuth("evo", "demo")),
                  (result) =>
                    `Step-up session active for ${(result as StepUpSessionPayload).principal}`
                ),
              toSuccessDetail: (result: unknown) => {
                const session = result as StepUpSessionPayload;
                setStepUpSession(session);
                setRequiresReauth(false);
                return `step-up token ${session.token}`;
              },
              onFailure: () => {
                setStepUpSession(null);
                setRequiresReauth(true);
              },
              onCommandLog
            });
          }}
        >
          {stepUpActive ? "Renew step-up" : "Step-up"}
        </button>
        <button
          type="button"
          disabled={action.loading || !stepUpSession}
          onClick={() => {
            setStepUpSession(null);
            setRequiresReauth(false);
          }}
        >
          Clear step-up
        </button>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(logLevelStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "set-log-level",
              inFlightLabel: "operations:set-log-level",
              execute: (token) => client.setLogLevel("debug", token),
              successPrefix: "Log level updated to debug",
              onFinally: () => void state.refresh()
            });
          }}
        >
          Set log level
        </button>
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(diagnosticsStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "diagnostics-bundle",
              inFlightLabel: "operations:diagnostics",
              execute: (token) => client.generateDiagnosticsBundle(token),
              successPrefix: "Diagnostics bundle requested"
            });
          }}
        >
          Diagnostics bundle
        </button>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(updatesChannelStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "set-channel-core",
              inFlightLabel: "operations:channel-core",
              execute: (token) => client.setUpdateChannel("core", "production", token),
              successPrefix: "Core channel set to production",
              onFinally: () => void state.refresh()
            });
          }}
        >
          Core channel: production
        </button>
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(updatesChannelStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "set-channel-plugins",
              inFlightLabel: "operations:channel-plugins",
              execute: (token) => client.setUpdateChannel("plugins", "test", token),
              successPrefix: "Plugin channel set to test",
              onFinally: () => void state.refresh()
            });
          }}
        >
          Plugin channel: test
        </button>
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(updatesCoreStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "apply-core-update",
              inFlightLabel: "operations:apply-core",
              execute: (token) => client.applyUpdate("core", token),
              successPrefix: "Core update apply requested",
              onFinally: () => void state.refresh()
            });
          }}
        >
          Apply core update
        </button>
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(updatesPluginsStatus, stepUpActive) || action.loading}
          onClick={() => {
            void runPrivilegedAction({
              action: "apply-plugin-updates",
              inFlightLabel: "operations:apply-plugins",
              execute: (token) => client.applyUpdate("plugins", token),
              successPrefix: "Plugin update apply requested",
              onFinally: () => void state.refresh()
            });
          }}
        >
          Apply plugin updates
        </button>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={!canRunPrivilegedOperation(sshStatus, stepUpActive) || action.loading}
          onClick={() => {
            const nextEnabled = !state.ssh?.enabled;
            void runPrivilegedAction({
              action: nextEnabled ? "ssh-enable" : "ssh-disable",
              inFlightLabel: "operations:ssh",
              execute: (token) => client.setSshEnabled(nextEnabled, token),
              successPrefix: `SSH ${nextEnabled ? "enable" : "disable"} requested`,
              onFinally: () => void state.refresh()
            });
          }}
        >
          Toggle SSH
        </button>
      </div>
      {plugins.length ? (
        <ul className="simple-list">
          {plugins.slice(0, 5).map((plugin: PluginAdminItemPayload) => {
            const removable = canRemovePlugin(plugin);
            return (
              <li key={plugin.plugin_id}>
                {plugin.name} ({plugin.distribution_model ?? plugin.source}, {plugin.trust_class ?? "n/a"}) -{" "}
                {plugin.enabled ? "enabled" : "disabled"} | {pluginPolicyHint(plugin)}
                <div className="action-row">
                  <button
                    type="button"
                    disabled={!canRunPrivilegedOperation(pluginLifecycleStatus, stepUpActive) || action.loading}
                    onClick={() => {
                      void runPrivilegedAction({
                        action: plugin.enabled ? "disable-plugin" : "enable-plugin",
                        inFlightLabel: "operations:toggle-plugin",
                        execute: (token) =>
                          plugin.enabled
                            ? client.disablePlugin(plugin.plugin_id, token)
                            : client.enablePlugin(plugin.plugin_id, token),
                        successPrefix: `${plugin.enabled ? "Disable" : "Enable"} plugin ${plugin.name}`,
                        onFinally: () => void state.refresh()
                      });
                    }}
                  >
                    {plugin.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      action.loading ||
                      !canRunPrivilegedOperation(pluginLifecycleStatus, stepUpActive) ||
                      !removable
                    }
                    onClick={() => {
                      void runPrivilegedAction({
                        action: "remove-plugin",
                        inFlightLabel: "operations:remove-plugin",
                        execute: (token) => client.removePlugin(plugin.plugin_id, token),
                        successPrefix: `Remove plugin ${plugin.name}`,
                        onFinally: () => void state.refresh()
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="action-row">
        <button
          type="button"
          disabled={state.loading}
          onClick={() => void runInFlight("operations:refresh", () => state.refresh())}
        >
          {state.loading ? "Loading..." : "Refresh operations"}
        </button>
      </div>
      {!stepUpActive ? (
        <p className="feature-hint">
          Privileged actions require active step-up (`scope.system.admin`) session.
        </p>
      ) : null}
      {requiresReauth ? (
        <p className="feature-hint">
          Step-up session expired or denied. Re-authenticate to continue privileged actions.
        </p>
      ) : null}
      {state.error ? <p className="feature-hint">{state.error}</p> : null}
      {action.error ? <p className="feature-hint">{action.error}</p> : null}
      {action.successMessage ? <p className="feature-success">{action.successMessage}</p> : null}
    </CapabilityGate>
  );
}
