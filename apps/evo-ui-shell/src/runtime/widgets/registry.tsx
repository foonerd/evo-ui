// Widget-kind registry. Maps the framework's `evo.*` Tier 1 widget
// kinds onto Preact components. Vendor plugins extend the registry
// by admitting `widget_kind_pack` artefacts; their kinds register
// alongside the Tier 1 set at admission time.
//
// The renderer consumes the registry by widget-kind id at admission
// time — every stocking the framework returns from
// `describe_ui_stockings` carries a `widget_kind_id`, and the
// renderer looks the id up to find which component to mount.

import type { ComponentType } from "preact";

import {
  KIND_BROWSE_TREE_ENTRY,
  KIND_METERING_PEAK,
  KIND_PLAYER_TRANSPORT,
  KIND_QUEUE_LIST,
  KIND_SEARCH_UNIFIED,
  KIND_SIGNAL_PATH,
  WidgetBrowseTreeEntry,
  WidgetMeteringPeak,
  WidgetPlayerTransport,
  WidgetQueueList,
  WidgetSearchUnified,
  WidgetSignalPath,
} from "./audio";

import {
  WidgetDiagnosticsEntry,
  WidgetPluginsEntry,
  WidgetPromptConfirm,
  WidgetPromptDatetime,
  WidgetPromptExternalRedirect,
  WidgetPromptFreeform,
  WidgetPromptMultiField,
  WidgetPromptMultiSelect,
  WidgetPromptPassword,
  WidgetPromptSelect,
  WidgetPromptSelectWithOther,
  WidgetPromptText,
  WidgetRoomsEntry,
  WidgetStatusBadge,
  WidgetThemePicker,
  WidgetUiShellPicker,
  WidgetUpdatesEntry,
  WidgetWizardCompletion,
  WidgetWizardConsent,
  WidgetWizardLocalization,
  WidgetWizardMultiroom,
  WidgetWizardNetwork,
  WidgetWizardWelcome,
} from "./tier1";

/**
 * Props the renderer hands every widget component when it mounts.
 * `envelope` is the manifest's `[[ui.stocks]]` payload deserialised;
 * `widgetKindId` is the canonical kind the renderer matched against
 * to find the component.
 */
export interface WidgetProps {
  shelfId: string;
  pluginId: string;
  stockingId: string;
  widgetKindId: string;
  envelope: Record<string, unknown>;
}

type WidgetComponent = ComponentType<WidgetProps>;

/**
 * Mutable widget-kind registry. The Tier 1 set is populated at
 * module load. Vendor `widget_kind_pack` artefacts register through
 * `register` at admission time so the renderer sees them alongside
 * the Tier 1 universals.
 */
export class WidgetRegistry {
  private readonly components = new Map<string, WidgetComponent>();

  public register(kindId: string, component: WidgetComponent): void {
    this.components.set(kindId, component);
  }

  public lookup(kindId: string): WidgetComponent | undefined {
    return this.components.get(kindId);
  }

  public has(kindId: string): boolean {
    return this.components.has(kindId);
  }

  public knownKinds(): readonly string[] {
    return [...this.components.keys()];
  }
}

/**
 * Build a fresh registry pre-populated with the framework's 23
 * Tier 1 widget kinds. Each kind is rendered by a dedicated Preact
 * component in the `widgets/tier1` module; the components share a
 * common visual primitive set so they compose into a coherent
 * operator surface without a per-shelf design pass.
 */
export function buildTier1Registry(): WidgetRegistry {
  const r = new WidgetRegistry();

  // Operator-tile shelves (system.* family).
  r.register("evo.plugins.entry", WidgetPluginsEntry);
  r.register("evo.diagnostics.entry", WidgetDiagnosticsEntry);
  r.register("evo.updates.entry", WidgetUpdatesEntry);

  // Prompt family.
  r.register("evo.prompt.text", WidgetPromptText);
  r.register("evo.prompt.password", WidgetPromptPassword);
  r.register("evo.prompt.select", WidgetPromptSelect);
  r.register("evo.prompt.select_with_other", WidgetPromptSelectWithOther);
  r.register("evo.prompt.multi_select", WidgetPromptMultiSelect);
  r.register("evo.prompt.confirm", WidgetPromptConfirm);
  r.register("evo.prompt.multi_field", WidgetPromptMultiField);
  r.register("evo.prompt.external_redirect", WidgetPromptExternalRedirect);
  r.register("evo.prompt.datetime", WidgetPromptDatetime);
  r.register("evo.prompt.freeform", WidgetPromptFreeform);

  // Multi-room.
  r.register("evo.rooms.entry", WidgetRoomsEntry);

  // Operator-selectable.
  r.register("evo.theme.picker", WidgetThemePicker);
  r.register("evo.ui.shell.picker", WidgetUiShellPicker);

  // Status surfaces.
  r.register("evo.status.badge", WidgetStatusBadge);

  // First-boot wizard family.
  r.register("evo.wizard.welcome", WidgetWizardWelcome);
  r.register("evo.wizard.localization", WidgetWizardLocalization);
  r.register("evo.wizard.consent", WidgetWizardConsent);
  r.register("evo.wizard.network", WidgetWizardNetwork);
  r.register("evo.wizard.multiroom", WidgetWizardMultiroom);
  r.register("evo.wizard.completion", WidgetWizardCompletion);

  return r;
}

/**
 * Register the audio reference-tier widget kinds (Tier 2) on the
 * supplied registry alongside the Tier 1 universals. Six kinds —
 * transport / queue / metering / browse / search / signal-path —
 * pair 1:1 with the framework-side widget-kind envelopes the
 * `evo-device-audio` distribution registers on the framework's
 * `WidgetKindRegistry` at boot.
 *
 * Long-term these components migrate to `evo-device-audio-ui` (a
 * dedicated shell admitted as a `kind = "UiShell"` artefact); the
 * registration call stays the same shape, only the import path
 * changes.
 */
export function registerAudioReferenceKinds(registry: WidgetRegistry): void {
  registry.register(KIND_PLAYER_TRANSPORT, WidgetPlayerTransport);
  registry.register(KIND_QUEUE_LIST, WidgetQueueList);
  registry.register(KIND_METERING_PEAK, WidgetMeteringPeak);
  registry.register(KIND_BROWSE_TREE_ENTRY, WidgetBrowseTreeEntry);
  registry.register(KIND_SEARCH_UNIFIED, WidgetSearchUnified);
  registry.register(KIND_SIGNAL_PATH, WidgetSignalPath);
}
