export type BootstrapPhase = "idle" | "connecting" | "ready" | "degraded" | "offline";
export type CapabilityStatus = "supported" | "partial" | "missing";
export type ErrorCategory =
  | "validation"
  | "capability"
  | "routing"
  | "upstream"
  | "auth"
  | "rate_limit"
  | "internal"
  | "timeout"
  | "not_implemented"
  | "dependency_unavailable";

export interface HealthPayload {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  version?: string;
}

export interface CapabilitiesPayload {
  version: number;
  capabilities: Record<string, CapabilityStatus>;
  notes?: string[];
}

export interface PlaybackStatePayload {
  status: "play" | "pause" | "stop";
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  seek?: number;
  volume?: number;
}

export interface QueueItemPayload {
  title: string;
  artist?: string;
  duration?: number;
}

export interface QueueSnapshotPayload {
  current_index: number | null;
  items: QueueItemPayload[];
}

export interface BrowseItemPayload {
  title: string;
  uri: string;
  type?: string;
  service?: string;
}

export interface BrowsePayload {
  items: BrowseItemPayload[];
}

export interface SearchPayload {
  items: BrowseItemPayload[];
}

// OutputDevicePayload / OutputsPayload retired: output-device
// selection moved to the framework plugin-request path. The typed
// device shape now lives as AudioOutputDevice in
// src/features/audio/audio-options-decoders.ts.

export interface NetworkStatusPayload {
  online: boolean;
  mode?: string;
  ssid?: string;
  ip?: string;
}

export type DeliveryChannel = "alpha" | "test" | "production";
export type UpdateTarget = "os" | "core" | "plugins";
export type PluginSource = "oop" | "community" | "bundled";
export type PluginDeploymentModel = "in_process" | "oop";
export type PluginDistributionModel = "bundled" | "admitted";
export type PluginTrustClass = "framework" | "anchored" | "self_attested";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface UpdateStatusPayload {
  versions: {
    os: string;
    core: string;
  };
  channels: {
    core: DeliveryChannel;
    plugins: DeliveryChannel;
  };
  pending: {
    os: number;
    core: number;
    plugins: number;
  };
}

export interface PluginAdminItemPayload {
  plugin_id: string;
  name: string;
  source: PluginSource;
  enabled: boolean;
  deployment_model?: PluginDeploymentModel;
  distribution_model?: PluginDistributionModel;
  trust_class?: PluginTrustClass;
}

export interface PluginsPayload {
  items: PluginAdminItemPayload[];
}

export interface SshStatusPayload {
  enabled: boolean;
}

export interface MaintenanceStatePayload {
  log_level: LogLevel;
}

export interface StepUpSessionPayload {
  token: string;
  principal: string;
  scope: "scope.system.admin";
  expires_at: string;
}

export interface UiErrorEnvelope {
  error: {
    code: string;
    category: ErrorCategory;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  request_id?: string;
}

export interface BootstrapResult {
  phase: BootstrapPhase;
  health: HealthPayload | null;
  capabilities: CapabilitiesPayload | null;
  error: string | null;
  retryable: boolean;
}

export interface UiEventFrame {
  event: string;
  seq?: number;
  payload?: Record<string, unknown>;
}

export interface UiSettingsPayload {
  revision: number;
  settings: Record<string, unknown>;
}

export type PlaybackCommand =
  | "play"
  | "pause"
  | "stop"
  | "next"
  | "previous"
  | "seek"
  | "set_volume"
  | "set_random"
  | "set_repeat";
