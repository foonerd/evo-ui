// DiagnosticsSurface - the Diagnostics stage of the System surface.
//
// Renders five rails:
//   - Connection   the framework realtime-stream endpoint + status
//   - Runtime      evo-ui-runtime health + the real capability keys
//   - Event stream happenings-stream integrity counters
//   - Command log  the operator command log + in-flight operations
//   - Main-stage   toggle for the centre-stage telemetry block
//
// Plugins are a separate stage of the System rail, so there is no
// Plugins rail here. This is one stage's detail body - the System
// surface provides the stage header and chrome around it.
//
// Note: the stale bootstrap "phase", the obsolete eight-key "feature
// gates" list, and the "control policy preview" of the old inline
// panel are deliberately not carried over - the framework never
// adopted that capability-contract model.

import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import type {
  CapabilitiesPayload,
  HealthPayload,
  UiEventFrame
} from "../../core/types";
import type { CommandLogEntry } from "../../core/command-log";

interface InFlightEntry {
  id: string;
  label: string;
  ageSeconds: number;
}

export interface DiagnosticsSurfaceProps {
  /** Framework realtime-stream endpoint URL. */
  wsUrl: string;
  /** Realtime-stream status (open / connecting / closed / ...). */
  streamStatus: string;
  /** Last close / error reason the stream reported, if any. */
  streamReason: string | null;
  /** Runtime health payload, or null before the first probe. */
  health: HealthPayload | null;
  /** Runtime capabilities payload, or null before the first probe. */
  capabilities: CapabilitiesPayload | null;
  /** Last bootstrap error, or null when the probe succeeded. */
  bootstrapError: string | null;
  eventsSeen: number;
  lastEvent: UiEventFrame | null;
  lastSeq: number | null;
  seqGapCount: number;
  seqRegressionCount: number;
  eventCounts: Record<string, number>;
  commandLog: ReadonlyArray<CommandLogEntry>;
  commandStats: { success: number; failures: number; total: number };
  inFlightEntries: ReadonlyArray<InFlightEntry>;
  inFlightSummary: string;
  /** Re-probe runtime health + capabilities. */
  onRefresh: () => void;
  onExportCommandLog: () => void;
  onClearCommandLog: () => void;
  /** Whether the engineer telemetry block shows on the home centre
   *  stage. Persisted UI preference, off by default. */
  mainStageDiagnostics: boolean;
  onMainStageDiagnosticsChange: (value: boolean) => void;
}

function formatTimestamp(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) return t("diag.na");
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    // A 13-digit value is already milliseconds; a 10-digit value is
    // epoch seconds and needs scaling.
    const ms = raw.length > 12 ? n : n * 1000;
    return new Date(ms).toLocaleString();
  }
  return raw;
}

export function DiagnosticsSurface({
  wsUrl,
  streamStatus,
  streamReason,
  health,
  capabilities,
  bootstrapError,
  eventsSeen,
  lastEvent,
  lastSeq,
  seqGapCount,
  seqRegressionCount,
  eventCounts,
  commandLog,
  commandStats,
  inFlightEntries,
  inFlightSummary,
  onRefresh,
  onExportCommandLog,
  onClearCommandLog,
  mainStageDiagnostics,
  onMainStageDiagnosticsChange
}: DiagnosticsSurfaceProps) {
  useLocale();
  const capabilityEntries = capabilities?.capabilities
    ? Object.entries(capabilities.capabilities)
    : [];
  const eventCountEntries = Object.entries(eventCounts).sort(
    (a, b) => b[1] - a[1]
  );
  const hasAnomaly = seqGapCount > 0 || seqRegressionCount > 0;

  return (
    <div className="diagnostics-rails">
      {/* Rail 1 - Connection */}
      <section className="card diagnostics-rail">
        <h4>{t("diag.connection")}</h4>
        <dl className="settings-info">
          <dt>{t("diag.realtimeStream")}</dt>
          <dd>{streamStatus}</dd>
          <dt>{t("diag.endpoint")}</dt>
          <dd className="diagnostics-mono">{wsUrl}</dd>
          {streamReason !== null ? (
            <>
              <dt>{t("diag.lastReason")}</dt>
              <dd>{streamReason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {/* Rail 2 - Runtime */}
      <section className="card diagnostics-rail">
        <div className="section-head">
          <h4>{t("diag.runtime")}</h4>
          <div className="action-row">
            <button type="button" onClick={onRefresh}>
              {t("diag.refresh")}
            </button>
          </div>
        </div>
        <dl className="settings-info">
          <dt>{t("diag.status")}</dt>
          <dd>{health?.status ?? t("diag.unknown")}</dd>
          <dt>{t("diag.version")}</dt>
          <dd>{health?.version ?? t("diag.unknown")}</dd>
          <dt>{t("diag.reported")}</dt>
          <dd>{formatTimestamp(health?.timestamp)}</dd>
        </dl>
        {bootstrapError !== null ? (
          <p className="feature-hint">{bootstrapError}</p>
        ) : null}
        <p className="diagnostics-subhead">{t("diag.runtimeCaps")}</p>
        {capabilityEntries.length === 0 ? (
          <p className="feature-hint">{t("diag.capsNotLoaded")}</p>
        ) : (
          <ul className="diagnostics-caps">
            {capabilityEntries.map(([key, status]) => (
              <li key={key}>
                <span className="diagnostics-mono">{key}</span>
                <span className={`pill pill-${status}`}>{status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Rail 3 - Event stream */}
      <section className="card diagnostics-rail">
        <h4>{t("diag.eventStream")}</h4>
        <dl className="settings-info">
          <dt>{t("diag.eventsSeen")}</dt>
          <dd>{eventsSeen}</dd>
          <dt>{t("diag.lastEvent")}</dt>
          <dd>{lastEvent?.event ?? t("diag.noneYet")}</dd>
          <dt>{t("diag.lastSeq")}</dt>
          <dd>{lastSeq ?? t("diag.na")}</dd>
          <dt>{t("diag.seqGaps")}</dt>
          <dd>{seqGapCount}</dd>
          <dt>{t("diag.seqRegressions")}</dt>
          <dd>{seqRegressionCount}</dd>
        </dl>
        {hasAnomaly ? (
          <p className="feature-hint">{t("diag.anomalies")}</p>
        ) : null}
        {eventCountEntries.length > 0 ? (
          <>
            <p className="diagnostics-subhead">{t("diag.byEventType")}</p>
            <ul className="simple-list">
              {eventCountEntries.map(([event, count]) => (
                <li key={event}>
                  {event}: {count}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* Rail 4 - Command log */}
      <section className="card diagnostics-rail">
        <div className="section-head">
          <h4>{t("diag.commandLog")}</h4>
          <div className="action-row">
            <button
              type="button"
              onClick={onExportCommandLog}
              disabled={commandLog.length === 0}
            >
              {t("diag.export")}
            </button>
            <button
              type="button"
              onClick={onClearCommandLog}
              disabled={commandLog.length === 0}
            >
              {t("diag.clear")}
            </button>
          </div>
        </div>
        <p className="feature-description">
          {t("diag.commandStats", {
            success: commandStats.success,
            failures: commandStats.failures,
            total: commandStats.total,
            inFlight: inFlightSummary
          })}
        </p>
        {inFlightEntries.length > 0 ? (
          <ul className="simple-list">
            {inFlightEntries.map((entry) => (
              <li key={entry.id}>
                {t("diag.running", { label: entry.label, s: entry.ageSeconds })}
              </li>
            ))}
          </ul>
        ) : null}
        {commandLog.length > 0 ? (
          <ul className="simple-list">
            {commandLog.map((entry) => (
              <li key={entry.id}>
                [{new Date(entry.at).toLocaleTimeString()}] {entry.domain}.
                {entry.action} -{" "}
                <span className={entry.success ? "status-ok" : "status-fail"}>
                  {entry.success ? t("diag.ok") : t("diag.fail")}
                </span>{" "}
                ({entry.detail})
              </li>
            ))}
          </ul>
        ) : (
          <p className="feature-hint">{t("diag.noCommands")}</p>
        )}
      </section>

      {/* Rail 5 - Main-stage diagnostics toggle */}
      <section className="card diagnostics-rail">
        <h4>{t("diag.mainStage")}</h4>
        <p className="feature-description">{t("diag.mainStageHelp")}</p>
        <label className="settings-label">
          <input
            type="checkbox"
            checked={mainStageDiagnostics}
            onChange={(ev) =>
              onMainStageDiagnosticsChange(
                (ev.currentTarget as HTMLInputElement).checked
              )
            }
          />
          <span>{mainStageDiagnostics ? t("diag.enabled") : t("diag.disabled")}</span>
        </label>
      </section>
    </div>
  );
}
