import type {
  BrowsePayload,
  CapabilitiesPayload,
  HealthPayload,
  LogLevel,
  MaintenanceStatePayload,
  NetworkStatusPayload,
  PluginsPayload,
  PlaybackCommand,
  PlaybackStatePayload,
  QueueSnapshotPayload,
  SearchPayload,
  SshStatusPayload,
  StepUpSessionPayload,
  UpdateStatusPayload,
  UpdateTarget,
  DeliveryChannel,
  UiSettingsPayload,
  UiErrorEnvelope
} from "./types";

export class UiSettingsRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number | null) {
    super("ui settings revision mismatch");
  }
}

export class GatewayClient {
  constructor(private readonly baseUrl: string = "") {}

  async checkHealth(): Promise<HealthPayload> {
    return this.getJson<HealthPayload>("/api/ui/v1/health");
  }

  async fetchCapabilities(): Promise<CapabilitiesPayload> {
    return this.getJson<CapabilitiesPayload>("/api/ui/v1/capabilities");
  }

  async getPlaybackState(): Promise<PlaybackStatePayload> {
    return this.getJson<PlaybackStatePayload>("/api/ui/v1/playback/state");
  }

  async getQueue(): Promise<QueueSnapshotPayload> {
    return this.getJson<QueueSnapshotPayload>("/api/ui/v1/queue");
  }

  async browse(uri = "root", shelf = "default"): Promise<BrowsePayload> {
    const query = new URLSearchParams({ uri, shelf }).toString();
    return this.getJson<BrowsePayload>(`/api/ui/v1/browse?${query}`);
  }

  async search(query: string, scope = "global"): Promise<SearchPayload> {
    const params = new URLSearchParams({ q: query, scope }).toString();
    return this.getJson<SearchPayload>(`/api/ui/v1/search?${params}`);
  }

  async sendPlaybackCommand(command: PlaybackCommand, args?: Record<string, unknown>): Promise<string> {
    return this.postJson("/api/ui/v1/playback/command", { command, args });
  }

  async queueAdd(uri: string): Promise<string> {
    return this.postJson("/api/ui/v1/queue/add", { uri });
  }

  async queueRemove(index: number): Promise<string> {
    return this.postJson("/api/ui/v1/queue/remove", { index });
  }

  async queueMove(from: number, to: number): Promise<string> {
    return this.postJson("/api/ui/v1/queue/move", { from, to });
  }

  async queueClear(): Promise<string> {
    return this.postJson("/api/ui/v1/queue/clear", {});
  }

  // Output-device selection is NOT served here. It is a plugin
  // Respondent capability (delivery.list_cards + options.set_output_device)
  // and routes through the framework `request` op via useAudioOptions
  // - see src/features/audio/. The former /api/ui/v1/outputs* HTTP
  // routes were never implemented by evo-ui-runtime (returned
  // not_found_api) and have been retired; do not reintroduce them.

  // Network status/request over HTTP is retired: those /api/ui/v1/network/*
  // routes were never implemented by the runtime (they 404). Network
  // connectivity, scan, intent and apply all go through the
  // networking.link WS shelf (useNetworkLink). Do not reintroduce them.

  async stepUpAuth(processUser: string, password: string): Promise<StepUpSessionPayload> {
    return this.postJsonWithBody<StepUpSessionPayload>("/api/ui/v1/admin/auth/step-up", {
      process_user: processUser,
      password
    });
  }

  async getMaintenanceState(): Promise<MaintenanceStatePayload> {
    return this.getJson<MaintenanceStatePayload>("/api/ui/v1/maintenance/state");
  }

  async setLogLevel(level: LogLevel, stepUpToken: string): Promise<string> {
    return this.postAdminJson("/api/ui/v1/maintenance/log-level", { level }, stepUpToken);
  }

  async generateDiagnosticsBundle(stepUpToken: string): Promise<string> {
    return this.postAdminJson("/api/ui/v1/diagnostics/bundle", {}, stepUpToken);
  }

  async getUpdateStatus(): Promise<UpdateStatusPayload> {
    return this.getJson<UpdateStatusPayload>("/api/ui/v1/updates/status");
  }

  async setUpdateChannel(
    target: "core" | "plugins",
    channel: DeliveryChannel,
    stepUpToken: string
  ): Promise<string> {
    return this.postAdminJson("/api/ui/v1/updates/channel", { target, channel }, stepUpToken);
  }

  async applyUpdate(target: UpdateTarget, stepUpToken: string): Promise<string> {
    return this.postAdminJson("/api/ui/v1/updates/apply", { target }, stepUpToken);
  }

  async getPlugins(): Promise<PluginsPayload> {
    return this.getJson<PluginsPayload>("/api/ui/v1/plugins");
  }

  async enablePlugin(pluginId: string, stepUpToken: string): Promise<string> {
    return this.postAdminJson(`/api/ui/v1/plugins/${pluginId}/enable`, {}, stepUpToken);
  }

  async disablePlugin(pluginId: string, stepUpToken: string): Promise<string> {
    return this.postAdminJson(`/api/ui/v1/plugins/${pluginId}/disable`, {}, stepUpToken);
  }

  async removePlugin(pluginId: string, stepUpToken: string): Promise<string> {
    return this.postAdminJson(`/api/ui/v1/plugins/${pluginId}/remove`, {}, stepUpToken);
  }

  async getSshStatus(): Promise<SshStatusPayload> {
    return this.getJson<SshStatusPayload>("/api/ui/v1/ssh/status");
  }

  async setSshEnabled(enabled: boolean, stepUpToken: string): Promise<string> {
    return this.postAdminJson(
      enabled ? "/api/ui/v1/ssh/enable" : "/api/ui/v1/ssh/disable",
      {},
      stepUpToken
    );
  }

  async getUiSettings(): Promise<UiSettingsPayload> {
    return this.getJson<UiSettingsPayload>("/api/ui/v1/settings");
  }

  async patchUiSettings(
    changes: Record<string, unknown>,
    baseRevision?: number
  ): Promise<UiSettingsPayload> {
    const payload: Record<string, unknown> = { changes };
    if (typeof baseRevision === "number") {
      payload.baseRevision = baseRevision;
    }
    const response = await fetch(`${this.baseUrl}/api/ui/v1/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": createRequestId()
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 409) {
      const conflict = (await response.json().catch(() => null)) as
        | { currentRevision?: number }
        | null;
      throw new UiSettingsRevisionConflictError(
        typeof conflict?.currentRevision === "number" ? conflict.currentRevision : null
      );
    }
    await this.assertResponse(response);
    return response.json() as Promise<UiSettingsPayload>;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    await this.assertResponse(response);
    return response.json() as Promise<T>;
  }

  private async postJson(path: string, payload: Record<string, unknown>): Promise<string> {
    const requestId = createRequestId();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId
      },
      body: JSON.stringify(payload)
    });
    await this.assertResponse(response);
    const body = (await response.json().catch(() => null)) as { request_id?: string } | null;
    return body?.request_id ?? requestId;
  }

  private async postAdminJson(
    path: string,
    payload: Record<string, unknown>,
    stepUpToken: string
  ): Promise<string> {
    const requestId = createRequestId();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        "X-Step-Up-Token": stepUpToken
      },
      body: JSON.stringify(payload)
    });
    await this.assertResponse(response);
    const body = (await response.json().catch(() => null)) as { request_id?: string } | null;
    return body?.request_id ?? requestId;
  }

  private async postJsonWithBody<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": createRequestId()
      },
      body: JSON.stringify(payload)
    });
    await this.assertResponse(response);
    return response.json() as Promise<T>;
  }

  private async assertResponse(response: Response): Promise<void> {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as UiErrorEnvelope | null;
      if (body?.error) {
        throw new Error(
          `${body.error.code}: ${body.error.message} (${body.error.category})`
        );
      }
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }
  }
}

function createRequestId(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
