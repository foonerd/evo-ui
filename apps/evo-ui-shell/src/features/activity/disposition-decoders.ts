// Pure decoders for the audio.playback:disposition subject.
//
// Wire shape per evo-plugin-sdk/src/contract/disposition.rs:
//
//   { v:1, dispositions:[Disposition] }
//
//   Disposition = {
//     v, at_ms,
//     kind:          { kind: DispositionKind, ... },
//     action_taken:  { kind: DispositionAction, ... },
//     recovery_hint: { kind: RecoveryHint, ... } | null,
//     queue_position?:    u32,
//     track_uri?:         string,
//     source_id?:         string,
//     source_state_at_decision?: any,
//     runs?:              DispositionRun        // for TracksSkippedRun
//   }
//
// DispositionKind: TrackSkippedSourceOffline, TrackSkippedFileNotFound,
//   TrackSkippedPermissionDenied, TrackSkippedDecoderFailure,
//   TrackSkippedRateLimited, PlaybackPausedSourceOffline,
//   QueueExhaustedNoPlayable, TracksSkippedRun
//
// RecoveryHint: WakeSource{source_id}, RescanSource{source_id},
//   RemountUsb{source_id}, ReauthCloud{source_id},
//   CheckMountPermissions{source_id}, InspectTrack{uri},
//   AddPlayableTrack

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function intOrNull(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

export type DispositionKind =
  | "track_skipped_source_offline"
  | "track_skipped_file_not_found"
  | "track_skipped_permission_denied"
  | "track_skipped_decoder_failure"
  | "track_skipped_rate_limited"
  | "playback_paused_source_offline"
  | "queue_exhausted_no_playable"
  | "tracks_skipped_run"
  | "other";

function decodeDispositionKind(raw: unknown): DispositionKind {
  if (!isObject(raw)) return "other";
  const k = raw["kind"];
  switch (k) {
    case "track_skipped_source_offline":
    case "track_skipped_file_not_found":
    case "track_skipped_permission_denied":
    case "track_skipped_decoder_failure":
    case "track_skipped_rate_limited":
    case "playback_paused_source_offline":
    case "queue_exhausted_no_playable":
    case "tracks_skipped_run":
      return k;
    default:
      return "other";
  }
}

export type DispositionAction =
  | "skip_forward"
  | "skip_backward"
  | "pause"
  | "stop"
  | "retry_at_next_advance"
  | "other";

function decodeDispositionAction(raw: unknown): DispositionAction {
  if (!isObject(raw)) return "other";
  const k = raw["kind"];
  switch (k) {
    case "skip_forward":
    case "skip_backward":
    case "pause":
    case "stop":
    case "retry_at_next_advance":
      return k;
    default:
      return "other";
  }
}

/** Operator recovery affordance discriminator. Each variant
 *  carries a single payload field the surface uses to call the
 *  matching recovery verb. */
export type RecoveryHint =
  | { kind: "wake_source"; sourceId: string }
  | { kind: "rescan_source"; sourceId: string }
  | { kind: "remount_usb"; sourceId: string }
  | { kind: "reauth_cloud"; sourceId: string }
  | { kind: "check_mount_permissions"; sourceId: string }
  | { kind: "inspect_track"; uri: string }
  | { kind: "add_playable_track" }
  | { kind: "other" };

function decodeRecoveryHint(raw: unknown): RecoveryHint | null {
  if (!isObject(raw)) return null;
  const k = raw["kind"];
  if (
    k === "wake_source" ||
    k === "rescan_source" ||
    k === "remount_usb" ||
    k === "reauth_cloud" ||
    k === "check_mount_permissions"
  ) {
    const sourceId = stringOrNull(raw, "source_id");
    if (sourceId === null) return { kind: "other" };
    return { kind: k, sourceId };
  }
  if (k === "inspect_track") {
    const uri = stringOrNull(raw, "uri");
    if (uri === null) return { kind: "other" };
    return { kind: "inspect_track", uri };
  }
  if (k === "add_playable_track") {
    return { kind: "add_playable_track" };
  }
  return { kind: "other" };
}

export interface DispositionRun {
  count: number;
  fromPosition: number;
  toPosition: number;
}

function decodeDispositionRun(raw: unknown): DispositionRun | null {
  if (!isObject(raw)) return null;
  const count = intOrNull(raw, "count");
  const fromPosition = intOrNull(raw, "from_position");
  const toPosition = intOrNull(raw, "to_position");
  if (count === null || fromPosition === null || toPosition === null) {
    return null;
  }
  return { count, fromPosition, toPosition };
}

export interface DispositionEntry {
  atMs: number;
  kind: DispositionKind;
  action: DispositionAction;
  queuePosition: number | null;
  trackUri: string | null;
  sourceId: string | null;
  recoveryHint: RecoveryHint | null;
  run: DispositionRun | null;
}

export function decodeDispositionEntry(raw: unknown): DispositionEntry | null {
  if (!isObject(raw)) return null;
  const atMs = intOrNull(raw, "at_ms");
  if (atMs === null) return null;
  return {
    atMs,
    kind: decodeDispositionKind(raw["kind"]),
    action: decodeDispositionAction(raw["action_taken"]),
    queuePosition: intOrNull(raw, "queue_position"),
    trackUri: stringOrNull(raw, "track_uri"),
    sourceId: stringOrNull(raw, "source_id"),
    recoveryHint: decodeRecoveryHint(raw["recovery_hint"]),
    run: decodeDispositionRun(raw["runs"])
  };
}

export interface DispositionState {
  dispositions: DispositionEntry[];
}

export function decodeDispositionState(raw: unknown): DispositionState | null {
  if (!isObject(raw)) return null;
  const dispositionsRaw = raw["dispositions"];
  const dispositions: DispositionEntry[] = [];
  if (Array.isArray(dispositionsRaw)) {
    for (const entry of dispositionsRaw) {
      const decoded = decodeDispositionEntry(entry);
      if (decoded !== null) dispositions.push(decoded);
    }
  }
  return { dispositions };
}

/** Decode a subject_state_changed happening for the
 *  audio_playback_disposition subject. */
export function decodeDispositionStateHappening(
  raw: unknown
): DispositionState | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "audio_playback_disposition") return null;
  return decodeDispositionState(frame["new_state"]);
}

/** Operator-readable short label for a DispositionKind. */
export function formatDispositionKind(k: DispositionKind): string {
  switch (k) {
    case "track_skipped_source_offline":
      return "Track skipped: source offline";
    case "track_skipped_file_not_found":
      return "Track skipped: file missing";
    case "track_skipped_permission_denied":
      return "Track skipped: permission denied";
    case "track_skipped_decoder_failure":
      return "Track skipped: decoder refused";
    case "track_skipped_rate_limited":
      return "Track skipped: source rate-limited";
    case "playback_paused_source_offline":
      return "Playback paused: source offline";
    case "queue_exhausted_no_playable":
      return "Queue exhausted - no playable items";
    case "tracks_skipped_run":
      return "Tracks skipped (coalesced run)";
    default:
      return "Other event";
  }
}

/** Operator-readable label for a recovery hint, plus the action
 *  semantic the UI binds the button to. */
export function describeRecoveryHint(hint: RecoveryHint): {
  label: string;
  payload: Record<string, string>;
} | null {
  switch (hint.kind) {
    case "wake_source":
      return { label: "Wake source", payload: { source_id: hint.sourceId } };
    case "rescan_source":
      return {
        label: "Rescan source",
        payload: { source_id: hint.sourceId }
      };
    case "remount_usb":
      return {
        label: "Remount USB",
        payload: { source_id: hint.sourceId }
      };
    case "reauth_cloud":
      return {
        label: "Re-authenticate cloud",
        payload: { source_id: hint.sourceId }
      };
    case "check_mount_permissions":
      return {
        label: "Check mount permissions",
        payload: { source_id: hint.sourceId }
      };
    case "inspect_track":
      return { label: "Inspect track", payload: { uri: hint.uri } };
    case "add_playable_track":
      return { label: "Add tracks", payload: {} };
    default:
      return null;
  }
}

/** Format an at_ms timestamp as a local clock time "HH:MM:SS". */
export function formatClockTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
