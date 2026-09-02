import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AlarmClock,
  ChevronLeft,
  Compass,
  CornerLeftUp,
  DownloadCloud,
  HardDrive,
  Heart,
  Home,
  Info,
  Layers,
  Library,
  ListMusic,
  Menu,
  Settings2,
  Speaker,
  Volume2,
  Wrench,
  X
} from "lucide-preact";
import {
  GatewayClient,
  UiSettingsRevisionConflictError
} from "../core/gateway-client";
import { runBootstrap } from "../core/bootstrap";
import type { NavView } from "./nav-types";
import { PivotHome } from "../features/pivot/PivotHome";
import { usePresentation, usePresentationPlan } from "../runtime/presentation-context";
import {
  foldMinPriority,
  parseTargetKey,
  resolveLayoutDocument,
  resolveRemoteLayoutDocument
} from "../runtime/presentation-target";
import { readSessionScope, type SessionScope } from "../runtime/session-scope";
import { onEmbedProfileChange, readEmbedProfile } from "../runtime/designer-embed";
import {
  curateNavItems,
  splitAtDividers,
  type CuratableNavItem
} from "./nav-curation";
import { resolveLayout } from "../runtime/layout-document";
import { breakpointFor } from "../runtime/composition";
import {
  catalogSnapshot,
  DEFAULT_HOME_PAGE,
  synthesizeRemoteReference
} from "./widget-catalog";
import { DocPageView } from "./DocPageView";
import {
  parseDisplayProfileSettings,
  readDisplayPresetId,
  readNativeTargetKey,
  UI_PROFILE_SETTINGS_KEY
} from "../runtime/ui-profile";
import {
  loadDisplayPresetCatalog,
  type DisplayPresetEntry
} from "../runtime/display-preset-catalog";
import { isLayoutDebugMode, LayoutDebugBadge } from "../dev/LayoutDebugBadge";
import type { BootstrapResult } from "../core/types";
import { getCapabilityStatus } from "../core/feature-gates";
import { StepUpHost } from "../features/pairing/StepUpHost";
import { KioskCalibrationHost } from "../features/kiosk/KioskCalibrationHost";
import { kioskMode } from "../features/kiosk/kiosk-bridge";
import { PlaybackSurface } from "../features/playback/PlaybackSurface";
import { StageSurface } from "../features/playback/StageSurface";
import {
  PlayerShellProviders,
  usePlayback
} from "../features/playback/usePlayback";
import { SecondaryLiveProvider } from "../runtime/secondary-live";
import {
  readTitleOverflow,
  onTitleOverflowChange
} from "../features/playback/nowplaying-prefs";
import {
  readDesignerTheme,
  onDesignerAppearanceChange
} from "../runtime/designer-appearance";
import { useSpectrum } from "../features/playback/useSpectrum";
import { QueueSurface } from "../features/queue/QueueSurface";
import { ComingNextList } from "../features/queue/ComingNextList";
import { BrowseSurface } from "../features/browse/BrowseSurface";
import { LibrarySurface } from "../features/library/LibrarySurface";
import { FavouritesSurface } from "../features/favourites/FavouritesSurface";
import { PlaylistsSurface } from "../features/playlist/PlaylistsSurface";
import { WorksSurface } from "../features/works/WorksSurface";
import { TrackInfoSurface } from "../features/playback/TrackInfoSurface";
import { MetadataWidget } from "../features/playback/MetadataWidget";
import { SmartMetadataWidget } from "../features/playback/SmartMetadataWidget";
import { useWorks } from "../features/works/useWorks";
import { autoShouldShowWorksShelf } from "../features/works/works-decoders.ts";
import { useGatewayStream } from "../core/useGatewayStream";
import { makeDomainIconResolver } from "../core/domain-icons";
import { MultiroomSurface } from "../features/multiroom/MultiroomSurface";
import { SystemSurface } from "../features/system/SystemSurface";
import { PromptSurface } from "../features/prompts/PromptSurface";
import { NotificationSurfaces } from "../features/notifications/NotificationSurfaces";
import { SourcesSurface } from "../features/sources/SourcesSurface";
import { UsbDrivesSurface } from "../features/sources/UsbDrivesSurface";
import type { DiagnosticsSurfaceProps } from "../features/system/DiagnosticsSurface";
import { OperationsSurface } from "../features/operations/OperationsSurface";
import { SidebarSystemActions } from "../features/system/SidebarSystemActions";
import { ComingSoonSurface } from "../features/system/ComingSoonSurface";
import { useInFlightRegistry } from "../core/useInFlightRegistry";
import {
  appendCommandLogEntry,
  type CommandLogEntry,
  type NewCommandLogEntry
} from "../core/command-log";
import { summarizeCommandLog } from "../core/command-log-stats";
import {
  COMMAND_LOG_STORAGE_KEY,
  parseCommandLogStorage,
  serializeCommandLogStorage
} from "../core/command-log-storage";
import { normalizeVolumeStep } from "../core/playback-volume";
import {
  isListTextModeOverride,
  resolveListTextMode,
  type ListTextModeOverride
} from "../components/ListTextModeControl";
import { isLocaleId, setLocale, t, UI_LOCALE_SETTINGS_KEY } from "../runtime/i18n";
import { useLocale } from "../runtime/use-locale";
import { rangeFill } from "../runtime/range-fill";
import {
  CLASSICAL_METADATA_MODE_STORAGE_KEY,
  clampSensitivityDb,
  clampDecay,
  isVisualizerBinCount,
  isVisualizerChannelMode,
  isVisualizerPreset,
  PLAYBACK_VOLUME_STEP_STORAGE_KEY,
  VISUALIZER_BIN_COUNT_STORAGE_KEY,
  VISUALIZER_BIN_COUNTS,
  VISUALIZER_CHANNEL_MODE_STORAGE_KEY,
  VISUALIZER_CHANNEL_MODES,
  VISUALIZER_PRESET_STORAGE_KEY,
  VISUALIZER_PRESETS,
  VISUALIZER_SENSITIVITY_DB_DEFAULT,
  VISUALIZER_DECAY_DEFAULT,
  VISUALIZER_DECAY_STORAGE_KEY,
  VISUALIZER_SENSITIVITY_DB_MAX,
  VISUALIZER_SENSITIVITY_DB_MIN,
  VISUALIZER_SENSITIVITY_DB_STORAGE_KEY,
  VISUALIZER_PALETTE_STORAGE_KEY,
  VISUALIZER_COLOR_MODE_STORAGE_KEY,
  type VisualizerBinCountId,
  type VisualizerChannelModeId,
  type VisualizerPresetId,
} from "../features/playback/local-prefs";
import {
  isVizColorMode,
  isVizPalette,
  type VizColorMode,
  type VizPaletteId,
} from "../features/playback/viz-palettes";
import type { UiSettingsPayload } from "../core/types";

const INITIAL_STATE: BootstrapResult = {
  phase: "idle",
  health: null,
  capabilities: null,
  error: null,
  retryable: false
};

// Sidebar nav split into four intent-based groups. "Listen" is
// consumer-facing daily-use surfaces. "Device" is operator-as-
// administrator (configure + privileged ops). "Debug" is engineer
// / on-call inspection. "Output" houses every where-does-audio-go
// surface - multi-room today, future Chromecast / AirPlay / Sonos
// receivers as they're admitted. Multi-room moved here from
// "Listen" because it's an output-routing concern, not a daily-use
// consumer surface in its own right.
//
// Internal view ids ("system" for Settings, "multiroom" for the
// multi-room management view, etc.) stay unchanged so SystemSurface
// + activeView state machinery + bookmarks survive the regrouping.
// Labels live in the i18n catalog (nav.<id>) - resolved at RENDER
// time by curatableNavDefaults()/bottomNavItems() so a live language
// switch relabels the chrome without reload (release-gate rule).
const LISTEN_NAV_ITEMS = [
  { id: "home", icon: Home },
  { id: "library", icon: Library },
  { id: "explore", icon: Compass },
  { id: "playlists", icon: ListMusic },
  { id: "sources", icon: HardDrive },
  { id: "favourites", icon: Heart },
  { id: "works", icon: Library },
  { id: "trackinfo", icon: Info }
] as const;

const DEVICE_NAV_ITEMS = [
  { id: "system", icon: Settings2 },
  { id: "operations", icon: Wrench }
] as const;

const OUTPUT_NAV_ITEMS = [
  { id: "multiroom", icon: Speaker }
] as const;

// Alarms and Update are ordinary views in the System group - fully
// curatable like everything else. Power off and Reboot are ACTIONS,
// not views: they stay in SidebarSystemActions, whose presence is
// itself operator data (nav.power pinned/hidden).
const SYSTEM_ACTION_NAV_ITEMS = [
  { id: "alarm", icon: AlarmClock },
  { id: "update", icon: DownloadCloud }
] as const;

// Canonical curatable menu defaults, exported for the designer's Menu
// editor. Order, labels, AND group membership mirror the sidebar
// groups above - the editor seeds curation with these groups as
// dividers, so the shipped grouping survives the first edit. Only the
// power VERB cluster stays outside: it is chrome with its own
// pinned/hidden dial. Keep in sync with the group arrays.
export function curatableNavDefaults(): readonly CuratableNavItem[] {
  const withGroup = (
    items: readonly { id: NavView }[],
    groupKey: "listen" | "device" | "output" | "system"
  ) =>
    items.map((item) => ({
      id: item.id,
      label: t(`nav.${item.id}` as never),
      group: t(`navGroup.${groupKey}` as never),
    }));
  return [
    ...withGroup(LISTEN_NAV_ITEMS, "listen"),
    ...withGroup(DEVICE_NAV_ITEMS, "device"),
    ...withGroup(OUTPUT_NAV_ITEMS, "output"),
    ...withGroup(SYSTEM_ACTION_NAV_ITEMS, "system"),
  ];
}

// Icon lookup for curated menus. A layout document orders and renames
// nav entries but never supplies icons - those stay with the view.
const NAV_ICONS: Partial<Record<NavView, typeof Home>> = Object.fromEntries(
  [
    ...LISTEN_NAV_ITEMS,
    ...DEVICE_NAV_ITEMS,
    ...OUTPUT_NAV_ITEMS,
    ...SYSTEM_ACTION_NAV_ITEMS
  ].map((item) => [item.id, item.icon])
);

// Mobile bottom nav: Listen + Settings + Multi-room. Operations
// stays drawer-only - an operator/engineer surface that should not
// crowd the consumer-facing bottom strip.
type AnyNavItem = { id: NavView; label: string; icon: typeof Home };
function bottomNavItems(): ReadonlyArray<AnyNavItem> {
  return [...LISTEN_NAV_ITEMS, OUTPUT_NAV_ITEMS[0], DEVICE_NAV_ITEMS[0]].map(
    (item) => ({ id: item.id, label: t(`nav.${item.id}` as never), icon: item.icon })
  );
}
// Playback/visualizer localStorage keys + value spaces live in
// features/playback/local-prefs.ts (single source - Show mode reads
// the same resolution).
const THEME_STORAGE_KEY = "evo-ui-shell.theme";
const DENSITY_STORAGE_KEY = "evo-ui-shell.density";
const COLLECTION_VIEW_MODE_STORAGE_KEY = "evo-ui-shell.collection.viewMode";
const MAIN_STAGE_DIAGNOSTICS_STORAGE_KEY = "evo-ui-shell.diagnostics.mainStage";
const WORKS_SHELF_MODE_STORAGE_KEY = "evo-ui-shell.classical.worksShelfMode";

// Works shelf visibility mode. Auto = framework counters decide
// (show when works_with_multiple_recordings > 0); On = always show
// the sidebar entry even when the shelf is empty; Off = never
// show. Same three-button pattern as classicalMetadataMode.
const WORKS_SHELF_MODES = ["auto", "on", "off"] as const;
type WorksShelfMode = (typeof WORKS_SHELF_MODES)[number];

function isWorksShelfMode(value: string): value is WorksShelfMode {
  return value === "auto" || value === "on" || value === "off";
}

// Classical metadata strip mode. Per-device Appearance setting that
// gates the composer/conductor/year/ensemble/label strip on every
// track-bearing surface (Queue / Favourites / Playlists / Library
// file rows / Playback centre stage). Auto is the default: render
// the strip whenever the framework reports any classical tag for the
// track. On forces the strip on even when only a single field is
// populated. Off suppresses the strip globally regardless of tags.
// Pure tag-presence still gates the strip inside the component - Off
// is the only way to hide tracks that genuinely carry classical
// metadata.
const CLASSICAL_METADATA_MODES = ["auto", "on", "off"] as const;
type ClassicalMetadataMode = (typeof CLASSICAL_METADATA_MODES)[number];

function isClassicalMetadataMode(value: string): value is ClassicalMetadataMode {
  return value === "auto" || value === "on" || value === "off";
}

export const THEME_OPTIONS = [
  { id: "evo-default", label: "Evo Default" },
  { id: "night-sky", label: "Night Sky" },
  { id: "sunrise", label: "Sunrise" },
  { id: "air", label: "Air" },
  { id: "liquid", label: "Liquid" }
] as const;
export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];

function isThemeId(value: string): value is ThemeId {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export const DENSITY_OPTIONS = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" }
] as const;
export type DensityId = (typeof DENSITY_OPTIONS)[number]["id"];

function isDensityId(value: string): value is DensityId {
  return DENSITY_OPTIONS.some((option) => option.id === value);
}

// Universal collection view-mode. One per-device preference propagates
// to every collection surface (queue, browse, search, ...). Toggle
// state lives in the device's UI preference subject and is atomically
// fanned out the same way `ui.theme` is.
const COLLECTION_VIEW_MODES = ["list", "tile"] as const;
type CollectionViewMode = (typeof COLLECTION_VIEW_MODES)[number];

function isCollectionViewMode(value: string): value is CollectionViewMode {
  return value === "list" || value === "tile";
}

// Per-surface long-text overrides (ruled list-element standard).
// Each list surface's "Aa" control cycles System -> Scroll -> Wrap
// -> Truncate; the override is a DEVICE setting
// (ui.list.text_mode.<surface>) riding the same PATCH + fan-out as
// ui.collection.view_mode. "system" is never stored - it means
// "follow the device Long text setting" (titleOverflowMode).
const LIST_TEXT_MODE_SURFACES = [
  "queue",
  "playlists",
  "favourites",
  "browse"
] as const;
type ListTextSurface = (typeof LIST_TEXT_MODE_SURFACES)[number];
type ListTextModes = Record<ListTextSurface, ListTextModeOverride>;
const DEFAULT_LIST_TEXT_MODES: ListTextModes = {
  queue: "system",
  playlists: "system",
  favourites: "system",
  browse: "system"
};

function listTextModeKey(surface: ListTextSurface): string {
  return `ui.list.text_mode.${surface}`;
}

/** App root: shared framework transport + one playback store wrap
 *  the shell so stage/rail/pivot cannot open duplicate playback
 *  sockets on hard refresh. */
export function App(props: { embeddedInDisplayTest?: boolean } = {}) {
  return (
    <PlayerShellProviders>
      <AppShell {...props} />
      <StepUpHost />
      {kioskMode() === "glass" ? <KioskCalibrationHost /> : null}
    </PlayerShellProviders>
  );
}

function AppShell({
  embeddedInDisplayTest = false
}: {
  embeddedInDisplayTest?: boolean;
} = {}) {
  const client = useMemo(() => new GatewayClient(), []);
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "ws://localhost/api/ui/v1/ws";
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/ui/v1/ws`;
  }, []);
  const [state, setState] = useState<BootstrapResult>(INITIAL_STATE);
  const settingsRealtimeSupported =
    getCapabilityStatus(state.capabilities, "ui.settings.realtime") === "supported";
  const wsEnabled =
    state.phase !== "offline" &&
    settingsRealtimeSupported;
  const stream = useGatewayStream(wsUrl, wsEnabled);
  const { entries: inFlightEntries, summary: inFlightSummary, run: runInFlight } =
    useInFlightRegistry();
  const anomalySignal = stream.seqGapCount + stream.seqRegressionCount;
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);
  const [activeView, setActiveView] = useState<NavView>("home");
  // Which layout-document page is on screen while activeView is
  // "docpage". Kept separate so the closed NavView union stays the
  // router for built-in views.
  const [activeDocPage, setActiveDocPage] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("evo-default");
  const [density, setDensity] = useState<DensityId>("comfortable");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Right-rail volume control. Bound to the playback warden's
  // now_playing subject: the slider displays the live volume and
  // each change dispatches the set_volume transport verb. While a
  // drag is in flight the local value tracks the operator's finger;
  // it reconciles to the live volume once the now_playing happening
  // lands. Same store as StageSurface / PlaybackSurface / pivot.
  const rightRailPlayback = usePlayback();
  const liveVolume = rightRailPlayback.nowPlaying?.volume ?? null;
  const [rightRailVolumeDraft, setRightRailVolumeDraft] = useState<number | null>(null);
  const rightRailVolume = rightRailVolumeDraft ?? liveVolume ?? 0;
  const [playbackVolumeStep, setPlaybackVolumeStep] = useState(5);
  const [collectionViewMode, setCollectionViewMode] = useState<CollectionViewMode>("list");
  const [listTextModes, setListTextModes] = useState<ListTextModes>(
    DEFAULT_LIST_TEXT_MODES
  );
  const [classicalMetadataMode, setClassicalMetadataMode] =
    useState<ClassicalMetadataMode>("auto");
  const [worksShelfMode, setWorksShelfMode] =
    useState<WorksShelfMode>("auto");
  // Secondary sockets (queue / favourites / works / spectrum / …)
  // stay OFF until playback has a live WS. No timer fallback — that
  // recreated the F5 socket storm. Prompts stay always-on (credentials
  // / maintenance answers must not wait).
  const secondaryLive = rightRailPlayback.connection.kind === "connected";
  // useWorks mounts once at App level so its counter projection
  // drives the sidebar Auto-resolution, and the WorksSurface reads
  // the same state. Gated until secondaryLive.
  const worksState = useWorks(secondaryLive);
  // Synchronous initial read from localStorage so the visualiser
  // preset is correct from the first render - which is what
  // useSpectrum below keys its WebSocket-open decision on (open
  // unless the preset is "off"). The separate useEffect that
  // rehydrates from storage (below) is now a no-op on first mount
  // but kept for cross-tab updates if the storage event ever fires.
  const [visualizerPreset, setVisualizerPreset] = useState<VisualizerPresetId>(() => {
    if (typeof window === "undefined") return "bars";
    const stored = window.localStorage.getItem(VISUALIZER_PRESET_STORAGE_KEY);
    return stored !== null && isVisualizerPreset(stored) ? stored : "bars";
  });
  // Visualiser SYSTEM master switch. Device-owned (ui.visualizer.enabled):
  // the single true state, read from the device via applyUiSettings, never
  // per-browser. Off = visualiser off on the glass regardless of the style
  // preset. The designer studio's toggle is the one control that sets it.
  // Defaults OFF until the device says otherwise (opt-in; no visualiser /
  // no spectrum subscription until the operator has turned it on).
  const [visualizerEnabled, setVisualizerEnabled] = useState<boolean>(false);
  // Long now-playing title/artist behaviour (scroll ticker vs 2-line
  // wrap). Persisted per device; the designer updates it live via a
  // window event (see nowplaying-prefs).
  const [titleOverflowMode, setTitleOverflowMode] = useState(() =>
    readTitleOverflow()
  );
  useEffect(
    () => onTitleOverflowChange(() => setTitleOverflowMode(readTitleOverflow())),
    []
  );
  // Designer theme override: only when embedded in the browser
  // designer. Lets the operator preview a theme without changing the
  // device's applied ui.theme. null = follow the device theme.
  const [designerThemeOverride, setDesignerThemeOverride] = useState<
    string | null
  >(() => (embeddedInDisplayTest ? readDesignerTheme() : null));
  useEffect(() => {
    if (!embeddedInDisplayTest) return undefined;
    return onDesignerAppearanceChange(() =>
      setDesignerThemeOverride(readDesignerTheme())
    );
  }, [embeddedInDisplayTest]);
  // Wire-side spectrum subscription. Decodes the
  // audio_playback_spectrum_frame subject into a stable
  // pre-allocated buffer ref the centre-stage Visualizer reads
  // from inside its requestAnimationFrame loop. The hook does
  // not setState per frame - the only state surface is the
  // connection lifecycle - so subscribing here does not cause
  // app-wide re-renders at 30 Hz.
  //
  // The hook gates its WebSocket on the preset being anything but
  // "off" - the single on/off truth. When the visualiser is off, no
  // WS is opened, no spectrum frames are received, and the
  // framework's filter sees one less consumer of the
  // audio_playback_spectrum_frame subject. That is the wire-side
  // honesty the studio's "off" preset means.
  const spectrum = useSpectrum(
    visualizerEnabled && visualizerPreset !== "off" && secondaryLive
  );
  const [visualizerBinCount, setVisualizerBinCount] = useState<VisualizerBinCountId>(256);
  const [mainStageDiagnostics, setMainStageDiagnostics] = useState(false);
  const [visualizerChannelMode, setVisualizerChannelMode] = useState<VisualizerChannelModeId>("mono");
  const [visualizerSensitivityDb, setVisualizerSensitivityDb] = useState<number>(
    VISUALIZER_SENSITIVITY_DB_DEFAULT
  );
  const [visualizerDecay, setVisualizerDecay] = useState<number>(
    VISUALIZER_DECAY_DEFAULT
  );
  // Colour axis (viz-palettes.ts): palette + colour mode. Same
  // lifecycle as the other visualiser knobs - localStorage seed,
  // ui.visualizer.* runtime override, persisted on change.
  const [visualizerPalette, setVisualizerPalette] =
    useState<VizPaletteId>("theme");
  const [visualizerColorMode, setVisualizerColorMode] =
    useState<VizColorMode>("gradient");
  const [settingsRevision, setSettingsRevision] = useState<number | null>(null);
  // Declared native display target key (ui.display.native_target), written
  // by the designer's Apply. Authoritative for native-scope layout lookup.
  const [nativeTargetKey, setNativeTargetKey] = useState<string | null>(null);
  // Sub-page state for the current top-level view. Cleared on
  // top-level navigation (clean entry). Drives the breadcrumb's
  // Menuitem-home visibility (the three-affordance breadcrumb
  // shows Menuitem-home only when there is a sub-page to return
  // from).
  const [activeSubPage, setActiveSubPage] = useState<string | null>(null);
  const previousStreamStatusRef = useRef(stream.status);
  const commandStats = useMemo(() => summarizeCommandLog(commandLog), [commandLog]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const parsed = parseCommandLogStorage(window.localStorage.getItem(COMMAND_LOG_STORAGE_KEY));
      if (parsed.length > 0) {
        setCommandLog(parsed);
      }
    } catch {
      // Ignore storage read failures in engineering shell.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme && isThemeId(storedTheme)) {
      setTheme(storedTheme);
    }
    const storedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (storedDensity && isDensityId(storedDensity)) {
      setDensity(storedDensity);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedMode = window.localStorage.getItem(COLLECTION_VIEW_MODE_STORAGE_KEY);
    if (storedMode && isCollectionViewMode(storedMode)) {
      setCollectionViewMode(storedMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(COLLECTION_VIEW_MODE_STORAGE_KEY, collectionViewMode);
  }, [collectionViewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedMode = window.localStorage.getItem(
      CLASSICAL_METADATA_MODE_STORAGE_KEY
    );
    if (storedMode && isClassicalMetadataMode(storedMode)) {
      setClassicalMetadataMode(storedMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      CLASSICAL_METADATA_MODE_STORAGE_KEY,
      classicalMetadataMode
    );
  }, [classicalMetadataMode]);

  // Resolved boolean for surfaces. Auto + On both render the strip
  // whenever the track carries classical tags (the strip component
  // already returns null when every field is null, so Auto here is
  // effectively the same as On until the library-signal projection
  // lands - kept as a separate axis so a future autonomous default
  // can flip to Off when no track in the library carries classical
  // tags). Off suppresses the strip across every surface.
  const showClassicalStrip = classicalMetadataMode !== "off";

  // Works shelf mode persistence + Auto resolution.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(WORKS_SHELF_MODE_STORAGE_KEY);
    if (stored && isWorksShelfMode(stored)) setWorksShelfMode(stored);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKS_SHELF_MODE_STORAGE_KEY, worksShelfMode);
  }, [worksShelfMode]);

  // Auto resolves to "visible" when the framework counters say at
  // least one work has multiple recordings. Until the counters have
  // arrived, Auto defaults to visible so a fresh-install operator
  // does not face a missing-shelf surprise mid-tag-import.
  const showWorksShelf =
    worksShelfMode === "on" ||
    (worksShelfMode === "auto" &&
      (worksState.counters === null ||
        autoShouldShowWorksShelf(worksState.counters)));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedPreset = window.localStorage.getItem(VISUALIZER_PRESET_STORAGE_KEY);
    if (storedPreset && isVisualizerPreset(storedPreset)) {
      setVisualizerPreset(storedPreset);
    }
    const storedBinCount = window.localStorage.getItem(VISUALIZER_BIN_COUNT_STORAGE_KEY);
    if (storedBinCount !== null) {
      const parsed = Number(storedBinCount);
      if (isVisualizerBinCount(parsed)) {
        setVisualizerBinCount(parsed);
      }
    }
    const storedChannelMode = window.localStorage.getItem(VISUALIZER_CHANNEL_MODE_STORAGE_KEY);
    if (storedChannelMode && isVisualizerChannelMode(storedChannelMode)) {
      setVisualizerChannelMode(storedChannelMode);
    }
    const storedSensitivityDb = window.localStorage.getItem(VISUALIZER_SENSITIVITY_DB_STORAGE_KEY);
    if (storedSensitivityDb !== null) {
      const parsed = Number(storedSensitivityDb);
      if (Number.isFinite(parsed)) {
        setVisualizerSensitivityDb(clampSensitivityDb(parsed));
      }
    }
    const storedDecay = window.localStorage.getItem(VISUALIZER_DECAY_STORAGE_KEY);
    if (storedDecay !== null) {
      const parsedDecay = Number(storedDecay);
      if (Number.isFinite(parsedDecay)) {
        setVisualizerDecay(clampDecay(parsedDecay));
      }
    }
    const storedPalette = window.localStorage.getItem(VISUALIZER_PALETTE_STORAGE_KEY);
    if (isVizPalette(storedPalette)) {
      setVisualizerPalette(storedPalette);
    }
    const storedColorMode = window.localStorage.getItem(VISUALIZER_COLOR_MODE_STORAGE_KEY);
    if (isVizColorMode(storedColorMode)) {
      setVisualizerColorMode(storedColorMode);
    }
    const storedMainStageDiag = window.localStorage.getItem(
      MAIN_STAGE_DIAGNOSTICS_STORAGE_KEY
    );
    if (storedMainStageDiag === "true" || storedMainStageDiag === "false") {
      setMainStageDiagnostics(storedMainStageDiag === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VISUALIZER_PRESET_STORAGE_KEY, visualizerPreset);
  }, [visualizerPreset]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      MAIN_STAGE_DIAGNOSTICS_STORAGE_KEY,
      String(mainStageDiagnostics)
    );
  }, [mainStageDiagnostics]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VISUALIZER_BIN_COUNT_STORAGE_KEY, String(visualizerBinCount));
  }, [visualizerBinCount]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VISUALIZER_CHANNEL_MODE_STORAGE_KEY, visualizerChannelMode);
  }, [visualizerChannelMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      VISUALIZER_SENSITIVITY_DB_STORAGE_KEY,
      String(visualizerSensitivityDb)
    );
  }, [visualizerSensitivityDb]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      VISUALIZER_DECAY_STORAGE_KEY,
      String(visualizerDecay)
    );
  }, [visualizerDecay]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VISUALIZER_PALETTE_STORAGE_KEY, visualizerPalette);
  }, [visualizerPalette]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(VISUALIZER_COLOR_MODE_STORAGE_KEY, visualizerColorMode);
  }, [visualizerColorMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(COMMAND_LOG_STORAGE_KEY, serializeCommandLogStorage(commandLog));
    } catch {
      // Ignore storage write failures in engineering shell.
    }
  }, [commandLog]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(PLAYBACK_VOLUME_STEP_STORAGE_KEY);
    if (!stored) {
      return;
    }
    setPlaybackVolumeStep(normalizeVolumeStep(Number(stored)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      PLAYBACK_VOLUME_STEP_STORAGE_KEY,
      String(normalizeVolumeStep(playbackVolumeStep))
    );
  }, [playbackVolumeStep]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // Same-document designer embed (self === top): never write the
    // device's stored theme or the global <html> theme - the preview is
    // themed only on its own app-shell (see effectiveTheme), so it cannot
    // clobber the device setting or fight the designer chrome. In the
    // iframe preview (self !== top) the App owns its own document and
    // MUST write its <html> theme like the real device does.
    const inIframe =
      typeof window !== "undefined" && window.self !== window.top;
    if (embeddedInDisplayTest && !inIframe) {
      return;
    }
    // Persist the device theme only for the real device session. The
    // iframe preview shares this origin's localStorage with the designer,
    // so it paints its <html> theme (below) but does not persist it.
    if (!embeddedInDisplayTest) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    const root = window.document.documentElement;
    const themeClassNames = THEME_OPTIONS.map((option) => `theme-${option.id}`);
    root.classList.remove(...themeClassNames);
    root.classList.add(`theme-${theme}`);
  }, [theme, embeddedInDisplayTest]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    window.document.documentElement.dataset.density = density;
  }, [density]);

  const presentationPlan = usePresentationPlan();
  const { profileSettings, setProfileSettings, setPresetId, setDiagonalInches, setDialTargetKey, setDialScope } = usePresentation();

  // On-device, the panel reports a hardware preset id; the catalogue maps that
  // to a physical diagonal. Resolving it here lets the device key its visual
  // profile by (resolution, size) and size touch targets from real PPI -
  // without the designer in the loop. The hardware id stays a timing identity
  // only; the diagonal it yields is the visual fact.
  const [presetCatalogue, setPresetCatalogue] = useState<readonly DisplayPresetEntry[]>([]);
  const [devicePresetId, setDevicePresetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDisplayPresetCatalog()
      .then((c) => {
        if (!cancelled) {
          setPresetCatalogue(c.entries);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (devicePresetId === null) {
      return;
    }
    const entry = presetCatalogue.find((e) => e.id === devicePresetId);
    if (entry !== undefined) {
      setDiagonalInches(entry.diagonalInches);
    }
  }, [presetCatalogue, devicePresetId, setDiagonalInches]);

  const applyUiSettings = useCallback((payload: UiSettingsPayload) => {
    setSettingsRevision(payload.revision);
    const runtimeTheme = payload.settings["ui.theme"];
    if (typeof runtimeTheme === "string" && isThemeId(runtimeTheme)) {
      setTheme(runtimeTheme);
    }
    // Language rides the same fan-out as the theme: ui.locale changes
    // reach every running session live through the settings stream.
    const runtimeLocale = payload.settings[UI_LOCALE_SETTINGS_KEY];
    if (isLocaleId(runtimeLocale)) {
      setLocale(runtimeLocale);
    }
    const runtimeVolumeStep = payload.settings["playback.volume.step"];
    if (typeof runtimeVolumeStep === "number") {
      setPlaybackVolumeStep(normalizeVolumeStep(runtimeVolumeStep));
    }
    const runtimeViewMode = payload.settings["ui.collection.view_mode"];
    if (typeof runtimeViewMode === "string" && isCollectionViewMode(runtimeViewMode)) {
      setCollectionViewMode(runtimeViewMode);
    }
    // Per-surface Aa overrides. A missing/cleared key (or anything
    // that is not scroll/wrap/truncate) resolves to "system" so a
    // remote clear fans out correctly to every session.
    setListTextModes((prev) => {
      let changed = false;
      const next: ListTextModes = { ...prev };
      for (const surface of LIST_TEXT_MODE_SURFACES) {
        const raw = payload.settings[listTextModeKey(surface)];
        const mode: ListTextModeOverride =
          isListTextModeOverride(raw) && raw !== "system" ? raw : "system";
        if (next[surface] !== mode) {
          next[surface] = mode;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    const runtimeVisualizerEnabled = payload.settings["ui.visualizer.enabled"];
    if (typeof runtimeVisualizerEnabled === "boolean") {
      setVisualizerEnabled(runtimeVisualizerEnabled);
    }
    const runtimeVisualizerPreset = payload.settings["ui.visualizer.preset"];
    if (typeof runtimeVisualizerPreset === "string" && isVisualizerPreset(runtimeVisualizerPreset)) {
      setVisualizerPreset(runtimeVisualizerPreset);
    }
    const runtimeVisualizerBinCount = payload.settings["ui.visualizer.bin_count"];
    if (isVisualizerBinCount(runtimeVisualizerBinCount)) {
      setVisualizerBinCount(runtimeVisualizerBinCount);
    }
    const runtimeVisualizerChannelMode = payload.settings["ui.visualizer.channel_mode"];
    if (typeof runtimeVisualizerChannelMode === "string" && isVisualizerChannelMode(runtimeVisualizerChannelMode)) {
      setVisualizerChannelMode(runtimeVisualizerChannelMode);
    }
    // sensitivity_db was PATCHed (studio + settings) but never
    // consumed here - the one visualiser knob that did not fan out
    // live. Closed alongside the palette keys.
    const runtimeVisualizerSensitivity = payload.settings["ui.visualizer.sensitivity_db"];
    if (typeof runtimeVisualizerSensitivity === "number") {
      setVisualizerSensitivityDb(clampSensitivityDb(runtimeVisualizerSensitivity));
    }
    const runtimeVisualizerDecay = payload.settings["ui.visualizer.decay"];
    if (typeof runtimeVisualizerDecay === "number") {
      setVisualizerDecay(clampDecay(runtimeVisualizerDecay));
    }
    // Classical metadata + works shelf promoted to DEVICE settings
    // (consolidation slice 3 - same per-browser-localStorage trap as
    // density): the designer's stage / Menu controls patch them, and
    // every session follows here. localStorage stays as boot
    // fallback and feeds the designer Show-mode parity readers.
    const runtimeClassical = payload.settings["ui.classical.metadata_mode"];
    if (typeof runtimeClassical === "string" && isClassicalMetadataMode(runtimeClassical)) {
      setClassicalMetadataMode(runtimeClassical);
    }
    const runtimeWorksShelf = payload.settings["ui.works.shelf_mode"];
    if (typeof runtimeWorksShelf === "string" && isWorksShelfMode(runtimeWorksShelf)) {
      setWorksShelfMode(runtimeWorksShelf);
    }
    // Density promoted to a DEVICE setting (consolidation slice 2):
    // the designer's Scale control patches ui.density; every session
    // follows live. localStorage remains the boot fallback only.
    const runtimeDensity = payload.settings["ui.density"];
    if (typeof runtimeDensity === "string" && isDensityId(runtimeDensity)) {
      setDensity(runtimeDensity);
    }
    const runtimeVisualizerPalette = payload.settings["ui.visualizer.palette"];
    if (isVizPalette(runtimeVisualizerPalette)) {
      setVisualizerPalette(runtimeVisualizerPalette);
    }
    const runtimeVisualizerColorMode = payload.settings["ui.visualizer.color_mode"];
    if (isVizColorMode(runtimeVisualizerColorMode)) {
      setVisualizerColorMode(runtimeVisualizerColorMode);
    }
    setProfileSettings(parseDisplayProfileSettings(payload.settings[UI_PROFILE_SETTINGS_KEY]));
    // The designer's Apply writes both the per-target layout (byTarget[key])
    // and the declared native_target key. The NativeMirror keys its render
    // off this declared key and renders correctly; the live panel previously
    // re-derived a key from measured geometry, which drifts on a rotated /
    // scaled panel and misses the layout - so the glass fell back to the
    // pinned default while theme/air (global settings) still applied. Store
    // the declared key and key the native layout off it: honour exactly what
    // was applied, the same key the mirror uses.
    setNativeTargetKey(readNativeTargetKey(payload.settings));
    // Resolve the operator DIALS (touch/type scale) off the declared
    // native_target on the glass - the designer writes them under that key,
    // so keying off measured geometry (which drifts) made Physical-scale
    // changes never land on the panel. Native sessions only; designer/remote
    // keep the measured key (null).
    setDialTargetKey(
      !embeddedInDisplayTest && readSessionScope() === "native"
        ? readNativeTargetKey(payload.settings)
        : null
    );
    const pid = readDisplayPresetId(payload.settings);
    setPresetId(pid);
    setDevicePresetId(pid);
    // Declared native identity (vendor-free "WxH@diag", written by
    // the designer's Apply): NATIVE sessions adopt its diagonal so
    // their target key forms and per-screen layouts + true-PPI touch
    // sizing resolve. Hardware preset id wins when present; remote
    // sessions never adopt native glass facts; the embedded preview
    // gets its profile over the embed channel instead.
    if (pid === null && !embeddedInDisplayTest && readSessionScope() === "native") {
      const declared = readNativeTargetKey(payload.settings);
      const parsed = declared !== null ? parseTargetKey(declared) : null;
      if (parsed !== null) {
        setDiagonalInches(parsed.diagonalInches);
      }
    }
  }, [setProfileSettings, setPresetId, setDiagonalInches, setDialTargetKey, embeddedInDisplayTest]);

  const fetchUiSettings = useCallback(async () => {
    try {
      const payload = await runInFlight("ui-settings:get", () => client.getUiSettings());
      applyUiSettings(payload);
    } catch {
      // Fallback remains local cache for offline/mock engineering mode.
    }
  }, [applyUiSettings, client, runInFlight]);

  const patchUiSettings = useCallback(
    async (changes: Record<string, unknown>) => {
      try {
        const payload = await runInFlight("ui-settings:patch", () =>
          client.patchUiSettings(changes, settingsRevision ?? undefined)
        );
        applyUiSettings(payload);
      } catch (error) {
        if (error instanceof UiSettingsRevisionConflictError) {
          const latest = await runInFlight("ui-settings:get", () => client.getUiSettings());
          applyUiSettings(latest);
          const retry = await runInFlight("ui-settings:patch-retry", () =>
            client.patchUiSettings(changes, latest.revision)
          );
          applyUiSettings(retry);
          return;
        }
      }
    },
    [applyUiSettings, client, runInFlight, settingsRevision]
  );

  // handleThemeChange RETIRED (consolidation slice 2): the designer
  // owns theme selection - preview via the designer override, device
  // persist via Apply (ui.theme). applyUiSettings still consumes the
  // fan-out, so every session follows a theme change live.

  const handleVolumeStepChange = useCallback(
    (step: number) => {
      const normalized = normalizeVolumeStep(step);
      setPlaybackVolumeStep(normalized);
      void patchUiSettings({ "playback.volume.step": normalized });
    },
    [patchUiSettings]
  );

  const handleCollectionViewModeChange = useCallback(
    (mode: CollectionViewMode) => {
      setCollectionViewMode(mode);
      void patchUiSettings({ "ui.collection.view_mode": mode });
    },
    [patchUiSettings]
  );

  // Style + palette picks from the immersive visualiser go through the
  // same authoritative settings path the studio uses, so they persist
  // and fan out live to the inline band and other seats.
  const handleVisualizerPresetChange = useCallback(
    (p: VisualizerPresetId) => {
      setVisualizerPreset(p);
      void patchUiSettings({ "ui.visualizer.preset": p });
    },
    [patchUiSettings]
  );
  const handleVisualizerPaletteChange = useCallback(
    (p: VizPaletteId) => {
      setVisualizerPalette(p);
      void patchUiSettings({ "ui.visualizer.palette": p });
    },
    [patchUiSettings]
  );

  const handleListTextModeChange = useCallback(
    (surface: ListTextSurface, mode: ListTextModeOverride) => {
      setListTextModes((prev) => ({ ...prev, [surface]: mode }));
      // "system" is never stored: cycling back patches the key away
      // (null clears the override; applyUiSettings resolves anything
      // invalid to "system").
      void patchUiSettings({
        [listTextModeKey(surface)]: mode === "system" ? null : mode
      });
    },
    [patchUiSettings]
  );

  /** Bundle of the three per-surface Aa props every list surface
   *  takes: the RESOLVED mode for its TrackTiles plus the raw
   *  override + change handler for its Aa control. */
  const listTextProps = (surface: ListTextSurface) => ({
    textMode: resolveListTextMode(listTextModes[surface], titleOverflowMode),
    textModeOverride: listTextModes[surface],
    onTextModeOverrideChange: (mode: ListTextModeOverride) =>
      handleListTextModeChange(surface, mode)
  });

  // The designer's Visualizer studio is the ONLY visualiser surface. Two
  // separate device settings back it, both device-owned (read via
  // applyUiSettings, no per-browser cache): the SYSTEM master switch
  // `ui.visualizer.enabled` (the studio toggle) and the STYLE `preset`
  // (bars/.../off) plus bins/channels/sensitivity/palette/colour mode. The
  // glass is on iff master AND preset != "off"; master off = off whatever
  // the style. The old Settings on/off card is retired - its control moved
  // into the studio, but the on/off STATE is NOT gone (that was a mistake,
  // reverted). No handleVisualizer*Change handlers; the studio patches the
  // device directly and applyUiSettings fans the change back to every
  // session.

  const bootstrap = useCallback(async () => {
    setState((prev: BootstrapResult) => ({ ...prev, phase: "connecting", error: null }));
    const next = await runInFlight("bootstrap", () => runBootstrap(client));
    setState(next);
    setCommandLog((prev: CommandLogEntry[]) =>
      appendCommandLogEntry(prev, {
        domain: "system",
        action: "bootstrap",
        success: next.phase !== "offline",
        detail: next.error ?? `phase=${next.phase}`
      })
    );
  }, [client, runInFlight]);

  const appendCommandLog = useCallback(
    (entry: NewCommandLogEntry) => {
      setCommandLog((prev: CommandLogEntry[]) => appendCommandLogEntry(prev, entry));
    },
    []
  );

  const exportCommandLog = useCallback(() => {
    if (typeof window === "undefined" || commandLog.length === 0) {
      return;
    }
    const payload = JSON.stringify(commandLog, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evo-ui-shell-command-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [commandLog]);

  // Clear the right-rail volume draft once the live now_playing
  // volume matches it - the dispatched set_volume has landed and
  // the slider can return to tracking framework truth.
  useEffect(() => {
    if (rightRailVolumeDraft !== null && liveVolume === rightRailVolumeDraft) {
      setRightRailVolumeDraft(null);
    }
  }, [liveVolume, rightRailVolumeDraft]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // The stage nav atom drives the SAME drawer the fab drives - one
  // mechanism, reachable from operator-placed content.
  useEffect(() => {
    const onToggle = () => setMobileSidebarOpen((v) => !v);
    window.addEventListener("evo:toggle-menu", onToggle);
    return () => window.removeEventListener("evo:toggle-menu", onToggle);
  }, []);

  useEffect(() => {
    void fetchUiSettings();
  }, [fetchUiSettings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (settingsRealtimeSupported && stream.status === "open") {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchUiSettings();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [fetchUiSettings, settingsRealtimeSupported, stream.status]);

  useEffect(() => {
    if (stream.lastEvent?.event === "ui.settings.changed") {
      void fetchUiSettings();
    }
  }, [fetchUiSettings, stream.lastEvent]);

  useEffect(() => {
    const previousStatus = previousStreamStatusRef.current;
    previousStreamStatusRef.current = stream.status;

    const recovered = previousStatus !== "open" && stream.status === "open";
    if (recovered && (state.phase === "offline" || state.phase === "degraded")) {
      void bootstrap();
    }
  }, [bootstrap, state.phase, stream.status]);

  const diagnosticsData: DiagnosticsSurfaceProps = {
    wsUrl,
    streamStatus: stream.status,
    streamReason: stream.reason ?? null,
    health: state.health,
    capabilities: state.capabilities,
    bootstrapError: state.error,
    eventsSeen: stream.eventsSeen,
    lastEvent: stream.lastEvent,
    lastSeq: stream.lastSeq ?? null,
    seqGapCount: stream.seqGapCount,
    seqRegressionCount: stream.seqRegressionCount,
    eventCounts: stream.eventCounts,
    commandLog,
    commandStats,
    inFlightEntries,
    inFlightSummary,
    onRefresh: () => void bootstrap(),
    onExportCommandLog: exportCommandLog,
    onClearCommandLog: () => setCommandLog([]),
    mainStageDiagnostics,
    onMainStageDiagnosticsChange: setMainStageDiagnostics
  };

  const navigateToView = (view: NavView) => {
    setActiveView(view);
    setActiveDocPage(null);
    setActiveSubPage(null);
    setMobileSidebarOpen(false);
  };

  // One-shot deep-link target for Library (Sources -> "Open in Library" on a
  // mounted NAS: source id nas-<shareId>). LibrarySurface focuses it, then
  // clears it via onDefaultSourceApplied so it never sticks.
  const [libraryTargetSource, setLibraryTargetSource] = useState<string | null>(
    null
  );
  const openInLibrary = (sourceId: string): void => {
    setLibraryTargetSource(sourceId);
    navigateToView("library");
  };

  const navigateToDocPage = (pageId: string) => {
    setActiveView("docpage");
    setActiveDocPage(pageId);
    setActiveSubPage(null);
    setMobileSidebarOpen(false);
  };
  // Space model: the menu is chrome that owns its width and nothing
  // else - hidden/drawer means content gets 100%, pinned means
  // content gets total minus menu. The ONLY rail is the document
  // page's rail region, governed solely by the page's own
  // railPosition set in the designer. The legacy profile-level rail
  // (and its dial) is gone - two controls for one concept was the
  // bug.
  const homeStandard =
    activeView === "home" && presentationPlan.interaction !== "pivot";
  const layoutClassName = homeStandard
    ? "app-layout app-layout-home"
    : "app-layout app-layout-subpage";
  // In the designer, an explicit theme override (if set) wins for the
  // preview; otherwise it follows the device theme. Outside the
  // designer this is always the device theme.
  const effectiveTheme =
    embeddedInDisplayTest &&
    designerThemeOverride !== null &&
    isThemeId(designerThemeOverride)
      ? designerThemeOverride
      : theme;
  const shellClassName = [
    "app-shell",
    "safe-area-inset",
    `theme-${effectiveTheme}`,
    embeddedInDisplayTest ? "app-shell-embedded-test" : "",
    presentationPlan.interaction === "pivot" ? "app-shell-pivot" : "",
    presentationPlan.interaction === "pivot" && activeView === "home"
      ? "app-shell-pivot-home"
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  // Session scope - the two-scope display model. NATIVE sessions
  // (kiosk on loopback, or an explicit /native entry) resolve the
  // attached screen's designed layout; REMOTE sessions (any browser,
  // or /remote) resolve the remote scope, whose default is the
  // derived full-reference view. The designer's embedded preview is
  // told its scope over the embed channel (it simulates whichever
  // scope the designer is editing; native until the selector says
  // otherwise) - its iframe URL must not classify it.
  const [embedScope, setEmbedScope] = useState<SessionScope>("native");
  useEffect(() => {
    if (!embeddedInDisplayTest) {
      return;
    }
    const apply = (): void =>
      setEmbedScope(readEmbedProfile()?.scope ?? "native");
    apply();
    return onEmbedProfileChange(apply);
  }, [embeddedInDisplayTest]);
  const sessionScope: SessionScope = embeddedInDisplayTest
    ? embedScope
    : readSessionScope();

  // Resolve the scale dials (touch/type) for THIS session's scope: a remote
  // browser reads the remote scope's own dials, the native glass reads the
  // native per-target ones, and the designer's embedded preview follows the
  // scope it is previewing. Independent touch/type per screen.
  useEffect(() => {
    setDialScope(sessionScope);
  }, [sessionScope, setDialScope]);

  // Operator-curated menu. When the active scope's layout document
  // (ui.profile -> layout.nav) carries page entries, they own the
  // sidebar's view order, labels, and visibility. No stored document
  // means no curation on native scopes - the hard-coded groups render
  // unchanged, so targets without a layout stay byte-identical to
  // before. The remote scope always has a document: its stored layout
  // or the derived reference.
  // Native layout keys off the DECLARED native_target (what the designer
  // applied, what the mirror renders), not the live-measured target key,
  // which drifts on a rotated/scaled panel and misses the stored layout.
  // Fall back to the measured key only when nothing was declared.
  const nativeLayoutKey = nativeTargetKey ?? presentationPlan.targetKey;
  const layoutDoc = useMemo(
    () =>
      sessionScope === "remote"
        ? resolveRemoteLayoutDocument(profileSettings) ?? synthesizeRemoteReference()
        : resolveLayoutDocument(nativeLayoutKey, profileSettings),
    [sessionScope, nativeLayoutKey, profileSettings]
  );

  // Locale is a render input for every catalog-resolved label below.
  const locale = useLocale();
  const curatedNav = useMemo(() => {
    // The works shelf is auto-gated by the library counters, but an
    // explicit works page in the layout document is operator intent
    // and always surfaces.
    const worksOverridden =
      layoutDoc?.pages.some((page) => page.id === "works") ?? false;
    const defaults = curatableNavDefaults().filter(
      (item) => item.id !== "works" || showWorksShelf || worksOverridden
    );
    return curateNavItems(defaults, layoutDoc);
  }, [layoutDoc, showWorksShelf, locale]);

  // Document pages resolved against the app widget catalog. Same
  // resolver, same envelope/budget semantics as the stocking path.
  const resolvedLayout = useMemo(
    () =>
      layoutDoc !== null
        ? resolveLayout(
            layoutDoc,
            catalogSnapshot(),
            breakpointFor(presentationPlan.effectiveW)
          )
        : null,
    [layoutDoc, presentationPlan.effectiveW]
  );

  const activeResolvedPage = useMemo(
    () =>
      activeDocPage !== null
        ? resolvedLayout?.pages.find((p) => p.page.id === activeDocPage) ?? null
        : null,
    [activeDocPage, resolvedLayout]
  );

  // If the page on screen leaves the document (designer removed it,
  // profile changed), fall back home instead of a blank stage.
  useEffect(() => {
    if (activeView === "docpage" && activeResolvedPage === null) {
      setActiveView("home");
      setActiveDocPage(null);
    }
  }, [activeView, activeResolvedPage]);

  const activeNavLabel = useMemo(() => {
    if (activeView === "docpage" && activeDocPage !== null) {
      const curated = curatedNav.items.find(
        (item) => item.kind === "page" && item.pageId === activeDocPage
      );
      if (curated !== undefined) return curated.label;
      return (
        layoutDoc?.pages.find((p) => p.id === activeDocPage)?.name ?? "Page"
      );
    }
    const curated = curatedNav.items.find(
      (item) => item.kind === "view" && item.id === activeView
    );
    if (curated !== undefined) return curated.label;
    // Fallback: every view id has a catalog key; t() falls back to
    // the key itself, never a blank.
    return t(("nav." + activeView) as never);
  }, [activeView, activeDocPage, curatedNav, layoutDoc, locale]);

  // Menu chrome from the layout document. Position left/right/none is
  // honoured directly; "bottom" has no full-layout surface yet and
  // degrades to left (documented tolerance, not a silent default).
  // Slide mode promotes the existing mobile drawer to every width -
  // one mechanism, not two.
  const navPosition = layoutDoc?.nav.position ?? "left";
  const navMode = layoutDoc?.nav.mode ?? "pinned";
  const navDrawer = navMode === "slide" || navPosition === "none";
  const effectiveNavPosition =
    navPosition === "bottom" ? "left" : navPosition;

  // Theme-resolved domain icons. Surfaces consult this resolver to
  // render the artwork placeholder for items without per-item
  // artwork. Switching theme rebuilds the resolver so any theme-
  // specific overrides apply immediately.
  const resolveDomainIcon = useMemo(() => makeDomainIconResolver(theme), [theme]);

  // Three-affordance breadcrumb (Back / Menuitem-home / Home).
  //
  // Back: one step up. From a sub-page, clears the sub-page (returns
  // to the menu item screen). From the menu item screen, returns to
  // Home.
  //
  // Menuitem home: returns to the menu item screen the current
  // drill-down began under. At depth one this equals Back; at deeper
  // hierarchies (future) it short-circuits to the section root.
  // Shown only when activeSubPage is set (per the subpage-layout
  // policy: "Hidden on the menu item screen itself").
  //
  // Home: returns to the main menu landing screen. Shown on every
  // non-root screen.
  const handleBack = useCallback(() => {
    if (activeSubPage !== null) {
      setActiveSubPage(null);
      return;
    }
    setActiveView("home");
    setActiveDocPage(null);
  }, [activeSubPage]);

  const handleMenuitemHome = useCallback(() => {
    setActiveSubPage(null);
  }, []);

  const handleHomeNav = useCallback(() => {
    setActiveView("home");
    setActiveSubPage(null);
    setMobileSidebarOpen(false);
  }, []);

  // One widget renderer for every document-driven surface (custom
  // pages, view overrides, and the decomposed home). Each case is a
  // fully functional component - no placeholders.
  // Stage meta atoms have no direct handler wiring, so they route their
  // "add a key" CTA through a window event that lands on the metadata
  // credentials screen - same destination as the page widgets' handler.
  useEffect(() => {
    const open = () => {
      navigateToView("system");
      setActiveSubPage("metadata");
    };
    window.addEventListener("evo:open-metadata-credentials", open);
    return () =>
      window.removeEventListener("evo:open-metadata-credentials", open);
  }, []);

  const renderDocWidget = (widgetKindId: string) => {
    const openMetaCredentials = () => {
      navigateToView("system");
      setActiveSubPage("metadata");
    };
    switch (widgetKindId) {
      case "evo.app.nowplaying":
        // The stage: rows -> cells -> atoms, from the rendered page's
        // stage document (CLASSIC_STAGE when none stored). The legacy
        // monolith remains only on the pivot path.
        return (
          <StageSurface
            stage={activeStageDoc}
            navToggleAvailable={navDrawer}
            titleOverflowMode={titleOverflowMode}
            volumeStep={normalizeVolumeStep(playbackVolumeStep)}
            diagnosticsEnabled={mainStageDiagnostics}
            visualizerEnabled={visualizerEnabled}
            visualizerPreset={visualizerPreset}
            visualizerBinCount={visualizerBinCount}
            visualizerChannelMode={visualizerChannelMode}
            visualizerSensitivityDb={visualizerSensitivityDb}
            visualizerDecay={visualizerDecay}
            visualizerOnSelectPreset={handleVisualizerPresetChange}
            visualizerOnSelectPalette={handleVisualizerPaletteChange}
            visualizerPalette={visualizerPalette}
            visualizerColorMode={visualizerColorMode}
            spectrumFrame={spectrum.frameRef}
            showClassicalStrip={showClassicalStrip}
          />
        );
      case "evo.app.queue":
        return (
          <QueueSurface
            viewMode={collectionViewMode}
            onViewModeChange={handleCollectionViewModeChange}
            resolveDomainIcon={resolveDomainIcon}
            showClassicalStrip={showClassicalStrip}
            {...listTextProps("queue")}
          />
        );
      case "evo.app.browse":
        return (
          <LibrarySurface
            defaultSourceId={libraryTargetSource ?? undefined}
            onDefaultSourceApplied={() => setLibraryTargetSource(null)}
            viewMode={collectionViewMode}
            onViewModeChange={handleCollectionViewModeChange}
            showClassicalStrip={showClassicalStrip}
            {...listTextProps("browse")}
          />
        );
      case "evo.app.favourites":
        return (
          <FavouritesSurface
            viewMode={collectionViewMode}
            onViewModeChange={handleCollectionViewModeChange}
            showClassicalStrip={showClassicalStrip}
            {...listTextProps("favourites")}
          />
        );
      case "evo.app.playlists":
        return (
          <PlaylistsSurface
            viewMode={collectionViewMode}
            onViewModeChange={handleCollectionViewModeChange}
            showClassicalStrip={showClassicalStrip}
            {...listTextProps("playlists")}
          />
        );
      case "evo.app.works":
        // Explicitly placed by the operator - renders regardless of
        // the works auto-gate; the surface owns its empty states.
        return <WorksSurface worksState={worksState} />;
      case "evo.app.comingnext":
        return (
          <ComingNextList
            resolveDomainIcon={resolveDomainIcon}
            onOpenFullQueue={() => navigateToView("library")}
          />
        );
      case "evo.app.volume":
        return (
          <section className="card right-rail-volume">
            <div className="right-rail-volume-row">
              <Volume2 size={16} />
              <input
                style={rangeFill(rightRailVolume)}
                type="range"
                min={0}
                max={100}
                step={1}
                value={rightRailVolume}
                onChange={(event: Event) => {
                  const next = Number(
                    (event.currentTarget as HTMLInputElement).value
                  );
                  setRightRailVolumeDraft(next);
                  void rightRailPlayback.setVolume(next);
                }}
                className="right-rail-volume-slider"
                aria-label="Volume"
              />
              <span className="feature-hint">{rightRailVolume}%</span>
            </div>
          </section>
        );
      case "evo.app.meta.combined":
        return (
          <TrackInfoSurface
            nowPlaying={rightRailPlayback.nowPlaying}
            onOpenCredentials={openMetaCredentials}
          />
        );
      case "evo.app.meta.bio":
        return (
          <MetadataWidget
            nowPlaying={rightRailPlayback.nowPlaying}
            section="bio"
            onOpenCredentials={openMetaCredentials}
          />
        );
      case "evo.app.meta.albumnotes":
        return (
          <MetadataWidget
            nowPlaying={rightRailPlayback.nowPlaying}
            section="album"
            onOpenCredentials={openMetaCredentials}
          />
        );
      case "evo.app.meta.lyrics":
        return (
          <MetadataWidget
            nowPlaying={rightRailPlayback.nowPlaying}
            section="lyrics"
            onOpenCredentials={openMetaCredentials}
          />
        );
      case "evo.app.meta.provenance":
        return (
          <MetadataWidget
            nowPlaying={rightRailPlayback.nowPlaying}
            section="provenance"
            onOpenCredentials={openMetaCredentials}
          />
        );
      case "evo.app.meta.smart":
        return (
          <SmartMetadataWidget nowPlaying={rightRailPlayback.nowPlaying} />
        );
      default:
        return null;
    }
  };

  // Decomposed home: on standard layouts the home surface is ALWAYS
  // the document page - the stored one when the operator edited it,
  // otherwise DEFAULT_HOME_PAGE (the shipped landing expressed as
  // blocks). The old hard-coded hero and legacy rail survive only on
  // the pivot path. Fork happens transparently on first designer
  // edit; nothing is gated behind a chip on the device.
  const homeResolvedPage = useMemo(() => {
    if (presentationPlan.interaction === "pivot") return null;
    const stored = resolvedLayout?.pages.find((p) => p.page.id === "home");
    if (stored !== undefined) return stored;
    const withDefault = {
      schemaVersion: 1,
      pages: [DEFAULT_HOME_PAGE],
      nav: { position: "left" as const, entries: [] },
    };
    const resolved = resolveLayout(
      withDefault,
      catalogSnapshot(),
      breakpointFor(presentationPlan.effectiveW)
    );
    return resolved.pages.find((p) => p.page.id === "home") ?? null;
  }, [
    presentationPlan.interaction,
    presentationPlan.effectiveW,
    resolvedLayout
  ]);

  // Stage document for the page on screen: home or a doc page. Null =
  // CLASSIC_STAGE inside StageSurface.
  const activeStageDoc = useMemo(() => {
    const page =
      activeView === "home"
        ? homeResolvedPage?.page
        : activeResolvedPage?.page;
    return page?.stage ?? null;
  }, [activeView, homeResolvedPage, activeResolvedPage]);

  return (
    <SecondaryLiveProvider ready={secondaryLive}>
    <main
      className={shellClassName}
      data-nav-position={effectiveNavPosition}
      data-nav-chrome={navDrawer ? "drawer" : "pinned"}
    >
      {isLayoutDebugMode() ? <LayoutDebugBadge /> : null}
      {/* Drawer chrome affordance: a floating button, never a bar -
          the menu must not tax the stage's vertical space. Visible
          only under drawer chrome above the phone breakpoint (CSS);
          pivot hides it entirely. */}
      <button
        type="button"
        className="app-nav-fab"
        aria-label={mobileSidebarOpen ? t("app.menuClose") : t("app.menuOpen")}
        aria-expanded={mobileSidebarOpen}
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
      >
        {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      {/* The old app-header bar is gone at every width - the floating
          menu button is the single drawer affordance, and the stage
          never loses a row of pixels to chrome. */}

      <div className={layoutClassName}>
        {mobileSidebarOpen ? (
          <button
            type="button"
            className="app-sidebar-overlay"
            aria-label="Close sidebar"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}

        <aside className={mobileSidebarOpen ? "app-sidebar card app-sidebar-open" : "app-sidebar card"}>
          {/* ONE close affordance: the floating fab flips to an X when
              the drawer is open. The old in-row close button doubled
              it and the pair collided over the brand. */}
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark" />
            <strong>EVO</strong>
          </div>
          {curatedNav.curated ? (
            /* Curated menu, grouped at dividers: each divider starts a
               .nav-group with its label as the title - the exact chrome
               the shipped (uncurated) sidebar uses. Items before any
               divider render unheaded: every heading is operator data,
               none are forced. */
            splitAtDividers(curatedNav.items).map((group, gi) => (
              <div
                className="nav-group"
                data-nav-curated="true"
                key={`navgroup:${gi}:${group.label ?? ""}`}
              >
                {group.label !== null && group.label.length > 0 ? (
                  <p className="nav-group-title">{group.label}</p>
                ) : null}
                {group.label !== null && group.label.length === 0 ? (
                  <hr className="nav-group-rule" aria-hidden />
                ) : null}
                {group.items.map((item) => {
                  if (item.kind === "page") {
                    const active =
                      activeView === "docpage" && activeDocPage === item.pageId;
                    return (
                      <button
                        key={`page:${item.pageId}`}
                        type="button"
                        className={active ? "nav-button nav-button-active" : "nav-button"}
                        onClick={() => navigateToDocPage(item.pageId)}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="nav-button-content">
                          <Layers size={14} className="nav-icon" />
                          {/* Operator-named page: label is DATA, never translated. */}
                          <span>{item.label}</span>
                        </span>
                      </button>
                    );
                  }
                  const Icon = NAV_ICONS[item.id] ?? Home;
                  return (
                    <button
                      key={`view:${item.id}`}
                      type="button"
                      className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
                      onClick={() => navigateToView(item.id)}
                      aria-current={activeView === item.id ? "page" : undefined}
                    >
                      <span className="nav-button-content">
                        <Icon size={14} className="nav-icon" />
                        <span>{item.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <>
              <div className="nav-group">
                <p className="nav-group-title">{t("navGroup.listen")}</p>
                {LISTEN_NAV_ITEMS.filter(
                  (item) => item.id !== "works" || showWorksShelf
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
                    onClick={() => navigateToView(item.id)}
                    aria-current={activeView === item.id ? "page" : undefined}
                  >
                    <span className="nav-button-content">
                      <item.icon size={14} className="nav-icon" />
                      <span>{t(("nav." + item.id) as never)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="nav-group nav-group-secondary">
                <p className="nav-group-title">{t("navGroup.device")}</p>
                {DEVICE_NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
                    onClick={() => navigateToView(item.id)}
                    aria-current={activeView === item.id ? "page" : undefined}
                  >
                    <span className="nav-button-content">
                      <item.icon size={14} className="nav-icon" />
                      <span>{t(("nav." + item.id) as never)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="nav-group nav-group-output">
                <p className="nav-group-title">{t("navGroup.output")}</p>
                {OUTPUT_NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
                    onClick={() => navigateToView(item.id)}
                    aria-current={activeView === item.id ? "page" : undefined}
                  >
                    <span className="nav-button-content">
                      <item.icon size={14} className="nav-icon" />
                      <span>{t(("nav." + item.id) as never)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="nav-group">
                <p className="nav-group-title">{t("navGroup.system")}</p>
                {SYSTEM_ACTION_NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
                    onClick={() => navigateToView(item.id)}
                    aria-current={activeView === item.id ? "page" : undefined}
                  >
                    <span className="nav-button-content">
                      <item.icon size={14} className="nav-icon" />
                      <span>{t(("nav." + item.id) as never)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Power verbs (Reboot / Power off): chrome whose presence
              is operator data - nav.power "hidden" removes it. */}
          {(layoutDoc?.nav.power ?? "pinned") !== "hidden" ? (
            <SidebarSystemActions />
          ) : null}
        </aside>

        {/* Content track: everything the menu does not own. The rail
            divides THIS box per its placement - collision with the
            menu is impossible by construction. */}
        <div className="app-content">
        <section
          className={activeView === "home" ? "app-main surface-grid home-main" : "app-main surface-grid"}
        >
          {activeView !== "home" ? (
            <nav className="breadcrumb-bar" aria-label="Breadcrumb navigation">
              <button
                type="button"
                className="breadcrumb-button"
                onClick={handleBack}
                aria-label={t("app.back")}
                title={t("app.back")}
              >
                <ChevronLeft size={14} />
                <span>{t("app.back")}</span>
              </button>
              {activeSubPage !== null ? (
                <button
                  type="button"
                  className="breadcrumb-button"
                  onClick={handleMenuitemHome}
                  aria-label={t("app.returnTo", { name: activeNavLabel })}
                  title={t("app.returnTo", { name: activeNavLabel })}
                >
                  <CornerLeftUp size={14} />
                  <span>{activeNavLabel}</span>
                </button>
              ) : null}
              <button
                type="button"
                className="breadcrumb-button"
                onClick={handleHomeNav}
                aria-label="Home"
                title="Home"
              >
                <Home size={14} />
                <span>Home</span>
              </button>
            </nav>
          ) : null}
          {activeView === "docpage" && activeResolvedPage !== null ? (
            <DocPageView
              page={activeResolvedPage}
              renderWidget={renderDocWidget}
              minFoldPriority={foldMinPriority(presentationPlan.foldTier)}
            />
          ) : null}

          {activeView === "library" && (
            <QueueSurface
              viewMode={collectionViewMode}
              onViewModeChange={handleCollectionViewModeChange}
              resolveDomainIcon={resolveDomainIcon}
              showClassicalStrip={showClassicalStrip}
              {...listTextProps("queue")}
            />
          )}

          {activeView === "home" && homeResolvedPage !== null ? (
            <DocPageView
              page={homeResolvedPage}
              renderWidget={renderDocWidget}
              minFoldPriority={foldMinPriority(presentationPlan.foldTier)}
            />
          ) : null}

          {/* Pivot home. On standard layouts homeResolvedPage is
              always non-null, so the document page above is the one
              and only standard home - the old hero and its
              placeholder context card are gone. */}
          {activeView === "home" && homeResolvedPage === null ? (
            <div className="home-hero home-hero-pivot">
              <PivotHome
                onNavigate={navigateToView}
                smallLanding={presentationPlan.smallLanding}
                compass={presentationPlan.compass}
                volumeStep={normalizeVolumeStep(playbackVolumeStep)}
                diagnosticsEnabled={mainStageDiagnostics}
                visualizerEnabled={visualizerEnabled}
                visualizerPreset={visualizerPreset}
                visualizerBinCount={visualizerBinCount}
                visualizerChannelMode={visualizerChannelMode}
                visualizerSensitivityDb={visualizerSensitivityDb}
                visualizerDecay={visualizerDecay}
                visualizerOnSelectPreset={handleVisualizerPresetChange}
                visualizerOnSelectPalette={handleVisualizerPaletteChange}
                visualizerPalette={visualizerPalette}
                visualizerColorMode={visualizerColorMode}
                spectrumFrame={spectrum.frameRef}
                showClassicalStrip={showClassicalStrip}
                titleOverflowMode={titleOverflowMode}
              />
            </div>
          ) : null}

          {activeView === "explore" ? (
            <LibrarySurface
              defaultSourceId={libraryTargetSource ?? undefined}
              onDefaultSourceApplied={() => setLibraryTargetSource(null)}
              viewMode={collectionViewMode}
              onViewModeChange={handleCollectionViewModeChange}
              showClassicalStrip={showClassicalStrip}
              {...listTextProps("browse")}
            />
          ) : null}

          {activeView === "favourites" ? (
            <FavouritesSurface
              viewMode={collectionViewMode}
              onViewModeChange={handleCollectionViewModeChange}
              showClassicalStrip={showClassicalStrip}
              {...listTextProps("favourites")}
            />
          ) : null}

          {activeView === "playlists" ? (
            <PlaylistsSurface
              viewMode={collectionViewMode}
              onViewModeChange={handleCollectionViewModeChange}
              showClassicalStrip={showClassicalStrip}
              {...listTextProps("playlists")}
            />
          ) : null}

          {activeView === "works" ? (
            <WorksSurface worksState={worksState} />
          ) : null}

          {activeView === "trackinfo" ? (
            <TrackInfoSurface
              nowPlaying={rightRailPlayback.nowPlaying}
              onOpenCredentials={() => {
                navigateToView("system");
                setActiveSubPage("metadata");
              }}
            />
          ) : null}

          {activeView === "sources" ? (
            <Fragment>
              <SourcesSurface onOpenInLibrary={openInLibrary} />
              <UsbDrivesSurface />
            </Fragment>
          ) : null}

          {activeView === "system" ? (
            <SystemSurface
              networkStatus={getCapabilityStatus(state.capabilities, "network.settings")}
              client={client}
              lastEvent={stream.lastEvent}
              runInFlight={runInFlight}
              streamOpen={stream.status === "open"}
              anomalySignal={anomalySignal}
              onCommandLog={appendCommandLog}
              playbackVolumeStep={normalizeVolumeStep(playbackVolumeStep)}
              onPlaybackVolumeStepChange={handleVolumeStepChange}
              settingsStatus={getCapabilityStatus(state.capabilities, "ui.settings")}
              settingsRealtimeStatus={getCapabilityStatus(
                state.capabilities,
                "ui.settings.realtime"
              )}
              collectionViewMode={collectionViewMode}
              onCollectionViewModeChange={handleCollectionViewModeChange}
              health={state.health}
              settingsRevision={settingsRevision}
              activeSubPage={activeSubPage}
              onSubPageChange={setActiveSubPage}
              onOpenMultiroom={() => navigateToView("multiroom")}
              diagnostics={diagnosticsData}
              resolveDomainIcon={resolveDomainIcon}
            />
          ) : null}

          {activeView === "operations" && (
            <OperationsSurface
              logLevelStatus={getCapabilityStatus(state.capabilities, "maintenance.log_level")}
              diagnosticsStatus={getCapabilityStatus(state.capabilities, "diagnostics.bundle")}
              updatesChannelStatus={getCapabilityStatus(state.capabilities, "updates.channels")}
              updatesCoreStatus={getCapabilityStatus(state.capabilities, "updates.apply.core")}
              updatesPluginsStatus={getCapabilityStatus(state.capabilities, "updates.apply.plugins")}
              pluginLifecycleStatus={getCapabilityStatus(state.capabilities, "plugin.lifecycle")}
              sshStatus={getCapabilityStatus(state.capabilities, "system.ssh")}
              client={client}
              runInFlight={runInFlight}
              onCommandLog={appendCommandLog}
            />
          )}

          {activeView === "multiroom" ? (
            <MultiroomSurface
              resolveDomainIcon={resolveDomainIcon}
              viewMode={collectionViewMode}
              onViewModeChange={handleCollectionViewModeChange}
              activeSubPage={activeSubPage}
              onSubPageChange={setActiveSubPage}
            />
          ) : null}

          {activeView === "alarm" ? (
            <ComingSoonSurface
              title="Alarms and schedules"
              lede="Wake-up alarms, sleep timers and recurring playback schedules for this device."
              icon={<AlarmClock size={20} />}
              planned={[
                "Wake to a playlist or radio station at a set time",
                "Sleep timer that fades out and stops playback",
                "Recurring weekday and weekend schedules",
                "Several independent alarms, each enabled on its own"
              ]}
            />
          ) : null}

          {activeView === "update" ? (
            <ComingSoonSurface
              title="Software update"
              lede="Check for and apply framework and plugin updates on this device."
              icon={<DownloadCloud size={20} />}
              planned={[
                "Check for framework and plugin updates",
                "Apply an update with a clear progress indicator",
                "Choose a release channel (stable or beta)",
                "Review update history"
              ]}
            />
          ) : null}
        </section>

        {/* The legacy hard-coded right rail (fake spectrum, fake
            cast, duplicate volume) is gone. The home page's own rail
            region carries coming-next and volume as widgets, governed
            solely by the page's designer-set railPosition. */}
        </div>
      </div>

      <nav className="app-bottom-nav card">
        {bottomNavItems().map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeView === item.id ? "nav-button nav-button-active" : "nav-button"}
            onClick={() => setActiveView(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span className="nav-button-content">
              <item.icon size={14} className="nav-icon" />
              <span>{t(("nav." + item.id) as never)}</span>
            </span>
          </button>
        ))}
      </nav>

      {/* Framework user-interaction prompts (Phase 1b). Mounted once
          at App root; renders nothing unless this session holds the
          responder capability AND a prompt is open. */}
      <PromptSurface />

      {/* Notifications bell + tray + banner stack (Phase 2b). No
          chrome at all while the system is idle. */}
      <NotificationSurfaces />
    </main>
    </SecondaryLiveProvider>
  );
}
