// zone-verbs - the four zone verbs on shelf audio.zones, their payloads,
// the decoders for what they answer, the three ways an answer becomes the
// list on screen, and the choices a zone may hold.
//
// A zone is a name over one or more logical outputs (logical:<n>) the
// output stage already names. It is not an output, not an EQ, not a
// scene. The plugin mints its id (zone:<n>). The list is asked with { v }
// and nothing else and shown in the answer's order. Add sends { name,
// logical_output_ids }; an empty name or an empty membership is never
// sent. Update sends { id } with the new name, the new membership, or
// both, and nothing when nothing changed. Remove sends { id } only. Each
// of the three writes answers the zone it made, changed, or took away.
//
// Membership: each id is a logical:<n> from the named outputs on screen.
// A physical id is never a choice; an id another painted zone holds is
// not a choice, except on the zone being edited, which may keep its own.

import type { LogicalOutput } from "./logical-output-verbs";

export const ZONES_SHELF = "audio.zones";

export const ZONE_VERBS = {
  list: "zone.list",
  add: "zone.add",
  update: "zone.update",
  remove: "zone.remove",
  setEqEngaged: "zone.set_eq_engaged",
  setEqBand: "zone.set_eq_band"
} as const;

// A zone's own EQ, stored beside its name and membership: engaged or not,
// and exactly ten bands with the same ranges as the global EQ. This is
// a stored value the plugin answers; nothing here is the global EQ on
// audio.options, and nothing here selects a composition mode.
export const ZONE_EQ_BAND_COUNT = 10;
export const ZONE_EQ_FREQ_MIN_HZ = 20;
export const ZONE_EQ_FREQ_MAX_HZ = 20000;
export const ZONE_EQ_GAIN_MIN_DB = -15;
export const ZONE_EQ_GAIN_MAX_DB = 15;
export const ZONE_EQ_Q_MIN = 0.1;
export const ZONE_EQ_Q_MAX = 30;

export interface ZoneEqBand {
  freqHz: number;
  gainDb: number;
  q: number;
}

export interface ZoneEq {
  engaged: boolean;
  /** Exactly ZONE_EQ_BAND_COUNT bands. */
  bands: ZoneEqBand[];
}

/** The EQ a new zone starts with: off, every band 1000 Hz, 0 dB, Q 1. */
export function flatZoneEq(): ZoneEq {
  return {
    engaged: false,
    bands: Array.from({ length: ZONE_EQ_BAND_COUNT }, () => ({ freqHz: 1000, gainDb: 0, q: 1 }))
  };
}

/** One zone as the plugin answers it. */
export interface Zone {
  /** The id the plugin minted: zone:<n>. */
  id: string;
  /** The operator's name for it. */
  name: string;
  /** The logical outputs it holds, in the order given. */
  logicalOutputIds: string[];
  /** The zone's own stored EQ. */
  eq: ZoneEq;
}

export type AddZonePayload = { name: string; logical_output_ids: string[] };
export type UpdateZonePayload = { id: string; name?: string; logical_output_ids?: string[] };
export type RemoveZonePayload = { id: string };

/** The add payload, or null when the trimmed name or the membership is
 *  empty: neither is ever sent. */
export function addZonePayload(name: string, logicalOutputIds: ReadonlyArray<string>): AddZonePayload | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || logicalOutputIds.length === 0) return null;
  return { name: trimmed, logical_output_ids: [...logicalOutputIds] };
}

function sameMembership(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** The update payload: that zone's id and only what changed against the
 *  zone as listed. Null when nothing changed, when the new name is
 *  empty, or when the membership is empty - nothing is sent. */
export function updateZonePayload(
  current: Zone,
  next: { name: string; logicalOutputIds: ReadonlyArray<string> }
): UpdateZonePayload | null {
  const name = next.name.trim();
  if (name.length === 0 || next.logicalOutputIds.length === 0) return null;
  const payload: UpdateZonePayload = { id: current.id };
  if (name !== current.name) payload.name = name;
  if (!sameMembership(next.logicalOutputIds, current.logicalOutputIds)) {
    payload.logical_output_ids = [...next.logicalOutputIds];
  }
  if (payload.name === undefined && payload.logical_output_ids === undefined) return null;
  return payload;
}

/** The remove payload: the id and nothing else. */
export function removeZonePayload(id: string): RemoveZonePayload {
  return { id };
}

export type ZoneEqEngagedPayload = { id: string; engaged: boolean };
export type ZoneEqBandPayload = { id: string; index: number; freq_hz: number; gain_db: number; q: number };

/** The engage payload, or null when the flag does not change: nothing
 *  is sent. */
export function zoneEqEngagedPayload(current: Zone, engaged: boolean): ZoneEqEngagedPayload | null {
  if (current.eq.engaged === engaged) return null;
  return { id: current.id, engaged };
}

function inRange(v: number, min: number, max: number): boolean {
  return Number.isFinite(v) && v >= min && v <= max;
}

/** The band payload, or null when the index is outside 0..9, a field is
 *  outside its range, or the band is as it already is: nothing is sent. */
export function zoneEqBandPayload(current: Zone, index: number, band: ZoneEqBand): ZoneEqBandPayload | null {
  if (!Number.isInteger(index) || index < 0 || index >= ZONE_EQ_BAND_COUNT) return null;
  if (!inRange(band.freqHz, ZONE_EQ_FREQ_MIN_HZ, ZONE_EQ_FREQ_MAX_HZ)) return null;
  if (!inRange(band.gainDb, ZONE_EQ_GAIN_MIN_DB, ZONE_EQ_GAIN_MAX_DB)) return null;
  if (!inRange(band.q, ZONE_EQ_Q_MIN, ZONE_EQ_Q_MAX)) return null;
  const was = current.eq.bands[index];
  if (was !== undefined && was.freqHz === band.freqHz && was.gainDb === band.gainDb && was.q === band.q) return null;
  return { id: current.id, index, freq_hz: band.freqHz, gain_db: band.gainDb, q: band.q };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function decodeZoneEqBand(raw: unknown): ZoneEqBand | null {
  if (!isObject(raw)) return null;
  const freqHz = raw["freq_hz"];
  const gainDb = raw["gain_db"];
  const q = raw["q"];
  if (typeof freqHz !== "number" || !Number.isFinite(freqHz)) return null;
  if (typeof gainDb !== "number" || !Number.isFinite(gainDb)) return null;
  if (typeof q !== "number" || !Number.isFinite(q)) return null;
  return { freqHz, gainDb, q };
}

/** The zone's eq { engaged, bands }, or null when it is absent or the
 *  band list is not exactly ZONE_EQ_BAND_COUNT bands. */
export function decodeZoneEq(raw: unknown): ZoneEq | null {
  if (!isObject(raw)) return null;
  const bandsRaw = raw["bands"];
  if (!Array.isArray(bandsRaw) || bandsRaw.length !== ZONE_EQ_BAND_COUNT) return null;
  const bands: ZoneEqBand[] = [];
  for (const b of bandsRaw) {
    const band = decodeZoneEqBand(b);
    if (band === null) return null;
    bands.push(band);
  }
  return { engaged: raw["engaged"] === true, bands };
}

/** One zone { id, name, logical_output_ids, eq }, or null when it is not
 *  one - a zone without eq, or with a band list that is not exactly ten,
 *  is left out. */
export function decodeZone(raw: unknown): Zone | null {
  if (!isObject(raw)) return null;
  const id = raw["id"];
  const name = raw["name"];
  const ids = raw["logical_output_ids"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  if (!Array.isArray(ids)) return null;
  const eq = decodeZoneEq(raw["eq"]);
  if (eq === null) return null;
  const logicalOutputIds = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
  return { id, name, logicalOutputIds, eq };
}

/** The answer to add, update, and remove: { v, zone }. */
export function decodeZoneAnswer(raw: unknown): Zone | null {
  if (!isObject(raw)) return null;
  return decodeZone(raw["zone"]);
}

/** The answer to the list: { v, zones }, in the answer's order. Anything
 *  that is not a zone is left out; no list is an empty list. */
export function decodeZoneList(raw: unknown): Zone[] {
  if (!isObject(raw)) return [];
  const rows = raw["zones"];
  if (!Array.isArray(rows)) return [];
  const out: Zone[] = [];
  for (const r of rows) {
    const zone = decodeZone(r);
    if (zone !== null) out.push(zone);
  }
  return out;
}

export function withZoneAdded(list: ReadonlyArray<Zone>, zone: Zone): ReadonlyArray<Zone> {
  return [...list, zone];
}

export function withZoneUpdated(list: ReadonlyArray<Zone>, zone: Zone): ReadonlyArray<Zone> {
  return list.map((z) => (z.id === zone.id ? zone : z));
}

export function withZoneRemoved(list: ReadonlyArray<Zone>, zone: Zone): ReadonlyArray<Zone> {
  return list.filter((z) => z.id !== zone.id);
}

/** What a zone may hold: the named outputs on screen (logical:<n>), less
 *  the ids other painted zones hold. The zone being edited (editingId)
 *  may keep its own. Never a physical id - only named outputs are
 *  offered. */
export function zoneChoices(
  logicalOutputs: ReadonlyArray<LogicalOutput>,
  zones: ReadonlyArray<Zone>,
  editingId: string | null
): Array<{ id: string; label: string }> {
  const held = new Set<string>();
  for (const z of zones) {
    if (z.id === editingId) continue;
    for (const id of z.logicalOutputIds) held.add(id);
  }
  return logicalOutputs
    .filter((o) => o.id.startsWith("logical:") && !held.has(o.id))
    .map((o) => ({ id: o.id, label: o.name }));
}
