// alarm - the two alarm verbs on shelf audio.alarm, the set payload, the
// decoders for what they answer, and the weekday draft.
//
// One alarm: the weekdays the operator names, a local time, and a
// playlist. Set sends { weekdays, time, playlist_name } (the hook adds
// v): weekdays in the order the operator gave them, never reordered;
// time as HH:MM, the hour 00 through 23 and the minute 00 through 59;
// the playlist name trimmed. An empty list, a day named twice, a token
// outside the seven, a time that is not HH:MM, or a name empty once
// trimmed is never sent. Clear sends { } (the hook adds v). There is no
// read: the glass shows the alarm a set answered, or none.

export const ALARM_SHELF = "audio.alarm";

export const ALARM_VERBS = {
  set: "alarm.set",
  clear: "alarm.clear"
} as const;

export const ALARM_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type AlarmWeekday = (typeof ALARM_WEEKDAYS)[number];

/** The alarm as a set answered it. */
export interface Alarm {
  /** The day tokens, in the order answered. */
  weekdays: string[];
  /** Local HH:MM. */
  time: string;
  playlistName: string;
}

export type AlarmSetPayload = { weekdays: string[]; time: string; playlist_name: string };

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function isWeekday(token: string): boolean {
  return (ALARM_WEEKDAYS as ReadonlyArray<string>).includes(token);
}

/** The set payload in the operator's order, or null when the form is
 *  not one the alarm takes - nothing is sent. */
export function alarmSetPayload(
  weekdays: ReadonlyArray<string>,
  time: string,
  playlistName: string
): AlarmSetPayload | null {
  if (weekdays.length === 0) return null;
  const seen = new Set<string>();
  for (const day of weekdays) {
    if (!isWeekday(day) || seen.has(day)) return null;
    seen.add(day);
  }
  if (!TIME_RE.test(time)) return null;
  const name = playlistName.trim();
  if (name.length === 0) return null;
  return { weekdays: [...weekdays], time, playlist_name: name };
}

/** The weekday draft after a day button: the day appended when it was
 *  not chosen, taken out when it was. Never reordered. */
export function toggleWeekday(days: ReadonlyArray<string>, day: AlarmWeekday): string[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The set answer { v, alarm: { weekdays, time, playlist_name } }, or
 *  null when it is not an alarm. Weekdays stay in the order answered. */
export function decodeAlarmAnswer(raw: unknown): Alarm | null {
  if (!isObject(raw)) return null;
  const a = raw["alarm"];
  if (!isObject(a)) return null;
  const days = a["weekdays"];
  const time = a["time"];
  const name = a["playlist_name"];
  if (!Array.isArray(days) || days.length === 0) return null;
  if (!days.every((d): d is string => typeof d === "string" && d.length > 0)) return null;
  if (typeof time !== "string" || time.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  return { weekdays: [...days], time, playlistName: name };
}

/** The clear answer { v, status: "ok" }: true, or null when it is not. */
export function decodeAlarmCleared(raw: unknown): true | null {
  if (!isObject(raw)) return null;
  return raw["status"] === "ok" ? true : null;
}
