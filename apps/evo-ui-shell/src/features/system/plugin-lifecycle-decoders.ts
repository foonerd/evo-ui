// Pure decoders for the plugin-lifecycle Settings tile.
//
// Two framework wire surfaces feed the tile:
//
//   - list_plugins: the admitted-plugin inventory. Response value
//     shape is { current_seq, plugins: [{ name, shelf,
//     interaction_kind }], plugins_inventory: true }.
//   - the plugin_reload_dispatched happening: the async outcome of
//     a plugin_reload gesture. The framework Happening enum is
//     internally tagged on `type`, so the frame is
//     { type: "plugin_reload_dispatched", plugin, mode, outcome,
//       source, at }.
//
// Kept pure and Preact-free so the contract tests exercise them
// directly against synthesised wire frames.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringField(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Declared lifecycle mode of a plugin. `unknown` appears only on
 *  legacy fixtures where the manifest was not retained; production
 *  admission always yields one of the three real modes. */
export type PluginLifecycleMode =
  | "reactive-only"
  | "reload-cleanable"
  | "frozen"
  | "unknown";

const LIFECYCLE_MODES: ReadonlySet<string> = new Set<string>([
  "reactive-only",
  "reload-cleanable",
  "frozen"
]);

/** One admitted plugin from list_plugins. */
export interface PluginInventoryEntry {
  /** Canonical plugin name, e.g. org.evoframework.network. */
  name: string;
  /** Shelf the plugin answers on, e.g. networking.link. Empty when
   *  the framework omitted it. */
  shelf: string;
  /** Interaction kind: respondent, warden, or warden+respondent. */
  interactionKind: string;
  /** Declared lifecycle mode. `unknown` when the framework omitted
   *  the field (legacy build). */
  lifecycleMode: PluginLifecycleMode;
}

function coerceLifecycleMode(raw: string | null): PluginLifecycleMode {
  return raw !== null && LIFECYCLE_MODES.has(raw)
    ? (raw as PluginLifecycleMode)
    : "unknown";
}

/** Operator-readable label for a lifecycle mode. */
export function lifecycleModeLabel(mode: PluginLifecycleMode): string {
  switch (mode) {
    case "reactive-only":
      return "Reactive-only";
    case "reload-cleanable":
      return "Reload-cleanable";
    case "frozen":
      return "Frozen";
    case "unknown":
      return "Unknown";
  }
}

/** Decode the list_plugins response value into the plugin
 *  inventory, sorted by name for a stable render order. Tolerates
 *  both the bare array and the { plugins: [...] } envelope; skips
 *  entries with no name. */
export function decodePluginInventory(raw: unknown): PluginInventoryEntry[] {
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (isObject(raw) && Array.isArray(raw["plugins"])) {
    list = raw["plugins"];
  } else {
    return [];
  }
  const out: PluginInventoryEntry[] = [];
  for (const entry of list as unknown[]) {
    if (!isObject(entry)) continue;
    const name = stringField(entry, "name");
    if (name === null) continue;
    out.push({
      name,
      shelf: stringField(entry, "shelf") ?? "",
      interactionKind: stringField(entry, "interaction_kind") ?? "unknown",
      lifecycleMode: coerceLifecycleMode(stringField(entry, "lifecycle_mode"))
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** One degraded plugin from get_plugin_health.degraded. */
export interface PluginDegradedEntry {
  /** Canonical plugin name. */
  plugin: string;
  /** Reason - a kebab-case identifier prefix (admit_failures_exhausted
   *  / teardown_timeouts_exhausted / plugin_panic) plus readable
   *  detail. */
  reason: string;
}

/** Decoded get_plugin_health snapshot - only the fields the plugin
 *  tile renders. */
export interface PluginHealth {
  /** Plugins currently degraded. Empty when none. */
  degraded: PluginDegradedEntry[];
  /** Count of degraded plugins, or null when the framework build
   *  did not attach the degraded registry (degraded_count absent). */
  degradedCount: number | null;
}

/** Decode the get_plugin_health response value. Tolerates the
 *  { snapshot: {...} } envelope and a bare snapshot. */
export function decodePluginHealth(raw: unknown): PluginHealth {
  let snap: unknown = raw;
  if (isObject(raw) && isObject(raw["snapshot"])) snap = raw["snapshot"];
  if (!isObject(snap)) return { degraded: [], degradedCount: null };
  const degraded: PluginDegradedEntry[] = [];
  const list = snap["degraded"];
  if (Array.isArray(list)) {
    for (const entry of list as unknown[]) {
      if (!isObject(entry)) continue;
      const plugin = stringField(entry, "plugin");
      if (plugin === null) continue;
      degraded.push({
        plugin,
        reason: stringField(entry, "reason") ?? "degraded"
      });
    }
  }
  const countRaw = snap["degraded_count"];
  const degradedCount =
    typeof countRaw === "number" && Number.isFinite(countRaw)
      ? Math.round(countRaw)
      : null;
  return { degraded, degradedCount };
}

/** A decoded plugin_degraded happening. */
export interface PluginDegradedEvent {
  plugin: string;
  /** Kebab-case reason identifier. */
  reason: string;
  /** Operator-readable supplement. */
  detail: string;
}

/** Decode a plugin_degraded happening, or null when the frame is
 *  not one. Unwraps a leading { happening: ... } envelope. */
export function decodePluginDegradedEvent(
  raw: unknown
): PluginDegradedEvent | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "plugin_degraded") return null;
  const plugin = stringField(frame, "plugin");
  if (plugin === null) return null;
  return {
    plugin,
    reason: stringField(frame, "reason") ?? "degraded",
    detail: stringField(frame, "detail") ?? ""
  };
}

/** A decoded plugin_restored happening. */
export interface PluginRestoredEvent {
  plugin: string;
  /** operator_restore or admit_success. */
  source: string;
}

/** Decode a plugin_restored happening, or null when the frame is
 *  not one. Unwraps a leading { happening: ... } envelope. */
export function decodePluginRestoredEvent(
  raw: unknown
): PluginRestoredEvent | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "plugin_restored") return null;
  const plugin = stringField(frame, "plugin");
  if (plugin === null) return null;
  return { plugin, source: stringField(frame, "source") ?? "" };
}

/** Human-readable one-line summary of a degraded reason. Splits the
 *  kebab-case identifier prefix from any readable detail. */
export function pluginDegradedReasonMessage(reason: string): string {
  if (reason.startsWith("admit_failures_exhausted")) {
    return "Admission kept failing - the plugin was taken out of service.";
  }
  if (reason.startsWith("teardown_timeouts_exhausted")) {
    return "The plugin stopped responding to teardown and was taken out of service.";
  }
  if (reason.startsWith("plugin_panic")) {
    return "The plugin panicked and was taken out of service.";
  }
  return reason.length > 0 ? reason : "The plugin is degraded.";
}

/** The dispatcher outcomes carried on a plugin_reload_dispatched
 *  happening. Mirrors the framework's enumerated `outcome` values;
 *  `unknown` covers any future value this build does not name. */
export type PluginReloadOutcome =
  | "refused_frozen"
  | "substrate_driven_acknowledged"
  | "teardown_and_readmit_started"
  | "no_manifest_recorded"
  | "plugin_not_admitted"
  | "unknown";

/** A decoded plugin_reload_dispatched happening. */
export interface PluginReloadEvent {
  /** Canonical name of the plugin the reload was dispatched for. */
  plugin: string;
  /** Declared lifecycle mode (kebab-case): frozen, reactive-only,
   *  reload-cleanable. Empty when no manifest was recorded. */
  mode: string;
  /** Action the dispatcher took. */
  outcome: PluginReloadOutcome;
  /** Origin: file_watcher or operator_gesture. */
  source: string;
}

const RELOAD_OUTCOMES: ReadonlySet<string> = new Set<string>([
  "refused_frozen",
  "substrate_driven_acknowledged",
  "teardown_and_readmit_started",
  "no_manifest_recorded",
  "plugin_not_admitted"
]);

/** Decode a happening frame into a PluginReloadEvent, or null when
 *  the frame is not a plugin_reload_dispatched happening. Unwraps a
 *  leading { happening: ... } envelope. */
export function decodePluginReloadEvent(
  raw: unknown
): PluginReloadEvent | null {
  if (!isObject(raw)) return null;
  const frame = isObject(raw["happening"]) ? raw["happening"] : raw;
  if (frame["type"] !== "plugin_reload_dispatched") return null;
  const plugin = stringField(frame, "plugin");
  if (plugin === null) return null;
  const outcomeRaw = stringField(frame, "outcome") ?? "";
  const outcome: PluginReloadOutcome = RELOAD_OUTCOMES.has(outcomeRaw)
    ? (outcomeRaw as PluginReloadOutcome)
    : "unknown";
  return {
    plugin,
    mode: stringField(frame, "mode") ?? "",
    outcome,
    source: stringField(frame, "source") ?? ""
  };
}

/** Visual tone for a reload outcome. `ok` is a real reload in
 *  progress; `info` is a deliberate no-op the operator should
 *  understand; `warn` is a request that could not act. */
export type PluginReloadTone = "ok" | "info" | "warn";

/** Tone for a reload outcome. */
export function pluginReloadOutcomeTone(
  outcome: PluginReloadOutcome
): PluginReloadTone {
  switch (outcome) {
    case "teardown_and_readmit_started":
      return "ok";
    case "refused_frozen":
    case "substrate_driven_acknowledged":
    case "unknown":
      return "info";
    case "no_manifest_recorded":
    case "plugin_not_admitted":
      return "warn";
  }
}

/** Operator-readable one-line summary of a reload outcome. Honest
 *  about the deliberate no-op cases: a frozen plugin did not
 *  reload, and the operator is told why. */
export function pluginReloadOutcomeMessage(outcome: PluginReloadOutcome): string {
  switch (outcome) {
    case "teardown_and_readmit_started":
      return "Reload started - the plugin is tearing down and re-admitting.";
    case "refused_frozen":
      return "This plugin is frozen. Restart the device to apply a change.";
    case "substrate_driven_acknowledged":
      return "This plugin is reactive-only - it has no separate reload step; its state updates live.";
    case "no_manifest_recorded":
      return "This plugin cannot be reloaded (no recorded manifest).";
    case "plugin_not_admitted":
      return "That plugin is not currently admitted.";
    case "unknown":
      return "Reload dispatched.";
  }
}

/** Display label for a plugin: drops the org.evoframework. prefix
 *  when present, otherwise returns the name unchanged. */
export function shortPluginName(name: string): string {
  const prefix = "org.evoframework.";
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}
