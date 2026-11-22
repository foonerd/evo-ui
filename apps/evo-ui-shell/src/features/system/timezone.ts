// timezone - the device's time zone on shelf system.locale: the three
// verbs, their payloads, and the decoders for what they answer.
//
// timezone.get { v: 1 } answers the zone in force; timezone.list { v: 1 }
// answers the zones a set would apply. Both are reads. timezone.set
// { v: 1, timezone } answers the zone now in force, and that is the zone
// the glass shows. A name not on the list the device gave, and Factory,
// are never sent. A failed read names no zone and gives no list - the
// glass never invents a zone or paints an empty picker.

export const TIMEZONE_SHELF = "system.locale";

export const TIMEZONE_VERBS = {
  get: "timezone.get",
  list: "timezone.list",
  set: "timezone.set"
} as const;

const NOT_A_CHOICE = "Factory";

export function timezoneReadPayload(): { v: 1 } {
  return { v: 1 };
}

export type TimezoneSetPayload = { v: 1; timezone: string };

/** The set payload, or null when there is no list, the name is not on it,
 *  or the name is Factory - nothing is sent. */
export function timezoneSetPayload(
  name: string,
  list: ReadonlyArray<string> | null
): TimezoneSetPayload | null {
  if (list === null || name === NOT_A_CHOICE || !list.includes(name)) return null;
  return { v: 1, timezone: name };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The zone a get or a set answers, or null when it names none. */
export function decodeTimezoneAnswer(raw: unknown): string | null {
  if (!isObject(raw)) return null;
  const zone = raw["timezone"];
  return typeof zone === "string" && zone.length > 0 ? zone : null;
}

/** The list answer in its own order, or null when there is no list or it
 *  is empty - an empty list is not a picker. Factory is not a choice. */
export function decodeTimezoneList(raw: unknown): string[] | null {
  if (!isObject(raw)) return null;
  const list = raw["timezones"];
  if (!Array.isArray(list)) return null;
  const zones = list.filter(
    (z): z is string => typeof z === "string" && z.length > 0 && z !== NOT_A_CHOICE
  );
  return zones.length === 0 ? null : zones;
}
