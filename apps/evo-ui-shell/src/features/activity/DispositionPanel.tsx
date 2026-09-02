// DispositionPanel - rendered inside Settings > Activity alongside
// the existing presence-transitions feed. Subscribes to the
// audio_playback_disposition subject and renders the last 32
// autonomous decisions with per-entry recovery affordance.
//
// Recovery actions dispatch through useLibrary (the source-side
// verbs the hint maps to live there). InspectTrack and
// AddPlayableTrack hints are surfaced as link-buttons that navigate
// elsewhere - we don't fire them automatically.

import { useCallback, useState } from "preact/hooks";
import { Activity } from "lucide-preact";
import { useDisposition } from "./useDisposition";
import { useLibrary } from "../library/useLibrary";
import {
  describeRecoveryHint,
  formatClockTime,
  formatDispositionKind,
  type DispositionEntry,
  type RecoveryHint
} from "./disposition-decoders";

export function DispositionPanel() {
  const disposition = useDisposition();
  const library = useLibrary();
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>("");

  const runAction = useCallback(
    async (
      label: string,
      operation: () => Promise<{ ok: boolean; message?: string }>
    ): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFeedback(`${label}...`);
      try {
        const r = await operation();
        if (r.ok) {
          setFeedback("");
        } else {
          setFeedback(r.message ?? `${label} did not complete.`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setFeedback(`${label} failed: ${detail}`);
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const onRecoveryAction = useCallback(
    (hint: RecoveryHint, label: string) => {
      switch (hint.kind) {
        case "wake_source":
          void runAction(label, async () => {
            const r = await library.wakeSource(hint.sourceId);
            return r.ok ? { ok: true } : { ok: false, message: r.message };
          });
          break;
        case "rescan_source":
          void runAction(label, async () => {
            const r = await library.updateSource(hint.sourceId);
            return r.ok ? { ok: true } : { ok: false, message: r.message };
          });
          break;
        case "remount_usb":
        case "reauth_cloud":
        case "check_mount_permissions":
          // Surface as operator copy - the action is a hardware /
          // out-of-band gesture, not a verb dispatch. Tell the
          // operator what to do; the panel does not pretend.
          setFeedback(
            `${label}: this is an operator gesture - the framework cannot resolve it remotely.`
          );
          break;
        case "inspect_track":
          setFeedback(`Track to inspect: ${hint.uri}`);
          break;
        case "add_playable_track":
          setFeedback(
            "Add tracks via the Browse surface or load a playlist into the queue."
          );
          break;
        default:
          setFeedback(`Unknown recovery hint - cannot dispatch.`);
      }
    },
    [library, runAction]
  );

  const entries = disposition.state?.dispositions ?? [];
  // Sort newest-first by at_ms - the wire is ring-buffer-ordered,
  // not time-ordered, so the operator's mental model of "what just
  // happened" needs an explicit sort.
  const sorted = [...entries].sort((a, b) => b.atMs - a.atMs);

  return (
    <div className="disposition-panel">
      <div className="disposition-head">
        <div>
          <h3 className="disposition-title">
            <Activity size={16} className="disposition-title-icon" />
            Autonomous decisions
          </h3>
          <p className="disposition-meta">
            {disposition.state === null
              ? disposition.connection.kind === "error"
                ? `Feed unreachable: ${disposition.connection.reason ?? "no detail"}`
                : "Loading..."
              : sorted.length === 0
                ? "No autonomous decisions yet"
                : `${sorted.length} of 32 most recent`}
          </p>
        </div>
      </div>

      {feedback ? (
        <div className="disposition-feedback" role="status">
          {feedback}
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="disposition-empty">
          The playback engine has not made any autonomous decisions
          recently. Skip-on-offline, queue-exhausted, and similar
          events appear here when they happen.
        </div>
      ) : (
        <ul className="disposition-list">
          {sorted.map((entry, idx) => (
            <DispositionRow
              key={`${entry.atMs}:${idx}`}
              entry={entry}
              busy={busy}
              onRecovery={onRecoveryAction}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DispositionRow({
  entry,
  busy,
  onRecovery
}: {
  entry: DispositionEntry;
  busy: boolean;
  onRecovery: (hint: RecoveryHint, label: string) => void;
}) {
  const recovery =
    entry.recoveryHint !== null ? describeRecoveryHint(entry.recoveryHint) : null;
  const runText =
    entry.run !== null
      ? ` (${entry.run.count} tracks, positions ${entry.run.fromPosition + 1}-${entry.run.toPosition + 1})`
      : "";
  return (
    <li className="disposition-row">
      <div className="disposition-when">{formatClockTime(entry.atMs)}</div>
      <div className="disposition-what">
        <div className="disposition-kind">
          {formatDispositionKind(entry.kind)}
          {runText}
        </div>
        <div className="disposition-detail">
          {entry.trackUri !== null ? (
            <span>
              Track: <code>{entry.trackUri}</code>
            </span>
          ) : null}
          {entry.sourceId !== null ? (
            <span>
              {entry.trackUri !== null ? " - " : ""}
              Source: <code>{entry.sourceId}</code>
            </span>
          ) : null}
          {entry.queuePosition !== null ? (
            <span>
              {entry.trackUri !== null || entry.sourceId !== null ? " - " : ""}
              Position {entry.queuePosition + 1}
            </span>
          ) : null}
        </div>
      </div>
      <div className="disposition-action">
        {recovery !== null && entry.recoveryHint !== null ? (
          <button
            type="button"
            className="disposition-recovery-button"
            onClick={() => onRecovery(entry.recoveryHint!, recovery.label)}
            disabled={busy}
          >
            {recovery.label}
          </button>
        ) : (
          <span className="disposition-no-action">no action</span>
        )}
      </div>
    </li>
  );
}
