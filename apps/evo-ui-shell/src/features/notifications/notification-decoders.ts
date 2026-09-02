// notification-decoders - wire shapes for the system.notifications
// shelf (Phase 2b). Grounded against a LIVE envelope captured from
// the demo emitter on 2026-07-18:
//
//   read system.notifications.list_active ->
//   { envelope: { active: [record...], base_mode,
//     quiet_hours_active, quiet_hours_policy:
//     { start_minute, end_minute, downgrade_mode },
//     last_update_at } }
//
//   record: { handle: number, level: "info"|"warning"|"alert",
//     source_plugin, title_key, body_key, audio_payload,
//     actions: [ { kind: "dismiss" } | { kind: "invoke_verb",
//       plugin_id, verb, payload } | { kind: "navigate_to", ... } ],
//     priority: "routine"|"important"|"critical", group_with,
//     auto_dismiss_after_ms, resolved_mode, group_count, sent_at }
//
// The happening path is subject_state_changed for the
// system_notifications_active subject; new_state carries the same
// envelope body (unwrapped).
//
// title_key / body_key are translation keys owned by the emitting
// plugin. The plugin-catalog lookup is not wired yet (framework Q&A
// open); until it lands, keys are humanised for display - never
// hidden, never invented.

export type NotificationPriority = "routine" | "important" | "critical";

export type NotificationAction =
  | { kind: "dismiss" }
  | { kind: "invoke_verb"; pluginId: string; verb: string }
  | { kind: "unknown"; raw: string };

export interface NotificationItem {
  handle: number;
  sourcePlugin: string;
  titleKey: string;
  bodyKey: string | null;
  priority: NotificationPriority;
  groupWith: string | null;
  groupCount: number;
  autoDismissAfterMs: number | null;
  sentAtMs: number | null;
  actions: NotificationAction[];
}

export interface QuietHoursPolicy {
  startMinute: number;
  endMinute: number;
  downgradeMode: string;
}

export interface NotificationsState {
  active: NotificationItem[];
  baseMode: string;
  quietHoursActive: boolean;
  quietHours: QuietHoursPolicy;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function decodePriority(raw: unknown): NotificationPriority {
  return raw === "critical" || raw === "important" ? raw : "routine";
}

function decodeActions(raw: unknown): NotificationAction[] {
  if (!Array.isArray(raw)) return [];
  const out: NotificationAction[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const kind = str(entry, "kind") ?? "missing";
    if (kind === "dismiss") {
      out.push({ kind: "dismiss" });
    } else if (kind === "invoke_verb") {
      const pluginId = str(entry, "plugin_id");
      const verb = str(entry, "verb");
      if (pluginId !== null && verb !== null) {
        out.push({ kind: "invoke_verb", pluginId, verb });
      }
    } else {
      out.push({ kind: "unknown", raw: kind });
    }
  }
  return out;
}

function decodeItem(raw: unknown): NotificationItem | null {
  if (!isObject(raw)) return null;
  const handle = num(raw, "handle");
  const sourcePlugin = str(raw, "source_plugin");
  const titleKey = str(raw, "title_key");
  if (handle === null || sourcePlugin === null || titleKey === null) return null;
  const sentAt = raw["sent_at"];
  const sentAtMs =
    isObject(sentAt) && typeof sentAt["secs_since_epoch"] === "number"
      ? (sentAt["secs_since_epoch"] as number) * 1000
      : null;
  return {
    handle,
    sourcePlugin,
    titleKey,
    bodyKey: str(raw, "body_key"),
    priority: decodePriority(raw["priority"]),
    groupWith: str(raw, "group_with"),
    groupCount: num(raw, "group_count") ?? 1,
    autoDismissAfterMs: num(raw, "auto_dismiss_after_ms"),
    sentAtMs,
    actions: decodeActions(raw["actions"])
  };
}

function decodeBody(body: Record<string, unknown>): NotificationsState | null {
  const activeRaw = body["active"];
  if (!Array.isArray(activeRaw)) return null;
  const active: NotificationItem[] = [];
  for (const entry of activeRaw) {
    const item = decodeItem(entry);
    if (item !== null) active.push(item);
  }
  const policyRaw = body["quiet_hours_policy"];
  const policy: QuietHoursPolicy = isObject(policyRaw)
    ? {
        startMinute: num(policyRaw, "start_minute") ?? 0,
        endMinute: num(policyRaw, "end_minute") ?? 0,
        downgradeMode: str(policyRaw, "downgrade_mode") ?? "display_only"
      }
    : { startMinute: 0, endMinute: 0, downgradeMode: "display_only" };
  return {
    active,
    baseMode: str(body, "base_mode") ?? "display_only",
    quietHoursActive: body["quiet_hours_active"] === true,
    quietHours: policy
  };
}

/** Decode the list_active read response. Tolerates both the
 *  { envelope: {...} } wrapper and a bare envelope body. */
export function decodeNotificationsState(raw: unknown): NotificationsState | null {
  if (!isObject(raw)) return null;
  const body = isObject(raw["envelope"]) ? (raw["envelope"] as Record<string, unknown>) : raw;
  return decodeBody(body);
}

/** Decode a happening frame; null when not this subject's frame. */
export function decodeNotificationsHappening(raw: unknown): NotificationsState | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? (raw["happening"] as Record<string, unknown>) : raw;
  if (frame["type"] !== "subject_state_changed") return null;
  if (frame["subject_type"] !== "system_notifications_active") return null;
  return decodeNotificationsState(frame["new_state"]);
}

/** Sort for the tray + banner queue: priority desc, newest first.
 *  Critical pins to the top by construction. */
const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 2,
  important: 1,
  routine: 0
};

export function sortNotifications(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => {
    const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (p !== 0) return p;
    return (b.sentAtMs ?? 0) - (a.sentAtMs ?? 0);
  });
}

/** Minutes-since-midnight to "HH:MM" (quiet-hours rows). */
export function formatMinute(minute: number): string {
  const m = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  const h = Math.trunc(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" (native time input) to minutes-since-midnight;
 *  null on anything malformed. */
export function parseTimeToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** Humanise a translation key for display until plugin catalogs are
 *  wired: last-but-generic segments, underscores to spaces, first
 *  letter up. "doorbell.front_door.title.1" -> "Front door". */
export function humaniseKey(key: string): string {
  const parts = key.split(".").filter((p) => !/^(title|body|\d+)$/.test(p));
  const last = parts[parts.length - 1] ?? key;
  const words = last.replace(/_/g, " ").trim();
  return words.length === 0 ? key : words[0].toUpperCase() + words.slice(1);
}
