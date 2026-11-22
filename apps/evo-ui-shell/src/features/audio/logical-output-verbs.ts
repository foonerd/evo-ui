// logical-output-verbs - the four named-output verbs on the audio.delivery
// shelf, their payloads, the decoders for what they answer, and the three
// ways an answer becomes the list on screen.
//
// A named output is a name the operator gives to one physical hw:N,M
// output delivery.list_outputs already names. The plugin mints its id
// (logical:<n>). The list is asked with { v } and nothing else and shown
// in the answer's order; an empty answer is an empty list. Add sends
// { name, output_id } and nothing else, and an empty name is never sent.
// Update sends { id } with the new name, the new physical output, or
// both, and nothing when nothing changed. Remove sends { id } only. Each
// of the three writes answers the row it made, changed, or took away.
//
// Nothing here plays, pauses, enables, disables, or sets a volume: those
// five verbs stay on the physical row with its hw:N,M id. The picker
// stays the picker. Neither is named in this file.

export const LOGICAL_OUTPUT_VERBS = {
  list: "delivery.list_logical_outputs",
  add: "delivery.add_logical_output",
  update: "delivery.update_logical_output",
  remove: "delivery.remove_logical_output"
} as const;

/** One named output as the plugin answers it. */
export interface LogicalOutput {
  /** The id the plugin minted: logical:<n>. Never a physical id. */
  id: string;
  /** The operator's name for it. */
  name: string;
  /** The physical hw:N,M output it points at. */
  outputId: string;
}

export type AddLogicalOutputPayload = { name: string; output_id: string };
export type UpdateLogicalOutputPayload = { id: string; name?: string; output_id?: string };
export type RemoveLogicalOutputPayload = { id: string };

/** The add payload, or null when the trimmed name is empty or no
 *  physical output was picked: neither is ever sent. */
export function addLogicalOutputPayload(
  name: string,
  outputId: string
): AddLogicalOutputPayload | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || outputId.length === 0) return null;
  return { name: trimmed, output_id: outputId };
}

/** The update payload: that row's id and only what changed against the
 *  row as listed. Null when nothing changed, when the new name is
 *  empty, or when no physical output was picked - nothing is sent. */
export function updateLogicalOutputPayload(
  current: LogicalOutput,
  next: { name: string; outputId: string }
): UpdateLogicalOutputPayload | null {
  const name = next.name.trim();
  if (name.length === 0 || next.outputId.length === 0) return null;
  const payload: UpdateLogicalOutputPayload = { id: current.id };
  if (name !== current.name) payload.name = name;
  if (next.outputId !== current.outputId) payload.output_id = next.outputId;
  if (payload.name === undefined && payload.output_id === undefined) return null;
  return payload;
}

/** The remove payload: the id and nothing else. */
export function removeLogicalOutputPayload(id: string): RemoveLogicalOutputPayload {
  return { id };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One row { id, name, output_id }, or null when it is not a row. */
export function decodeLogicalOutput(raw: unknown): LogicalOutput | null {
  if (!isObject(raw)) return null;
  const id = raw["id"];
  const name = raw["name"];
  const outputId = raw["output_id"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  if (typeof outputId !== "string" || outputId.length === 0) return null;
  return { id, name, outputId };
}

/** The answer to add, update, and remove: { v, logical_output }. */
export function decodeLogicalOutputAnswer(raw: unknown): LogicalOutput | null {
  if (!isObject(raw)) return null;
  return decodeLogicalOutput(raw["logical_output"]);
}

/** The answer to the list: { v, logical_outputs }, in the answer's
 *  order. Anything that is not a row is left out; no list is an empty
 *  list. */
export function decodeLogicalOutputList(raw: unknown): LogicalOutput[] {
  if (!isObject(raw)) return [];
  const rows = raw["logical_outputs"];
  if (!Array.isArray(rows)) return [];
  const out: LogicalOutput[] = [];
  for (const r of rows) {
    const row = decodeLogicalOutput(r);
    if (row !== null) out.push(row);
  }
  return out;
}

/** After add: the list with the new row at the end. Ids are minted in
 *  order, so the end is the answer's order too. */
export function withAdded(
  list: ReadonlyArray<LogicalOutput>,
  row: LogicalOutput
): ReadonlyArray<LogicalOutput> {
  return [...list, row];
}

/** After update: the list with that row replaced by its id; every other
 *  row as it was. */
export function withUpdated(
  list: ReadonlyArray<LogicalOutput>,
  row: LogicalOutput
): ReadonlyArray<LogicalOutput> {
  return list.map((r) => (r.id === row.id ? row : r));
}

/** After remove: the list without that row; every other row as it was. */
export function withRemoved(
  list: ReadonlyArray<LogicalOutput>,
  row: LogicalOutput
): ReadonlyArray<LogicalOutput> {
  return list.filter((r) => r.id !== row.id);
}
