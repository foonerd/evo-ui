import type { UiEventFrame } from "./types";
import { isKnownStreamEvent } from "./stream-events";

type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";
type EventHandler = (frame: UiEventFrame) => void;
type StatusHandler = (status: StreamStatus, reason?: string) => void;

export class UiGatewayStream {
  private readonly eventHandlers = new Set<EventHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollAbort: AbortController | null = null;
  private pollTask: Promise<void> | null = null;
  private manuallyClosed = false;
  private lastSeq = 0;

  constructor(private readonly url: string) {}

  connect(): void {
    this.manuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelPoll();
    this.lastSeq = 0;
    this.emitStatus("connecting");
    this.pollTask = this.runLongPollLoop();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelPoll();
    this.emitStatus("closed");
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private emitStatus(status: StreamStatus, reason?: string): void {
    this.statusHandlers.forEach((handler) => handler(status, reason));
  }

  private cancelPoll(): void {
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
    this.pollTask = null;
  }

  private async runLongPollLoop(): Promise<void> {
    this.reconnectAttempts = 0;
    this.emitStatus("open");
    while (!this.manuallyClosed) {
      this.pollAbort = new AbortController();
      try {
        const endpoint = this.toLongPollUrl(this.lastSeq);
        const response = await fetch(endpoint, {
          method: "GET",
          signal: this.pollAbort.signal,
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (response.status === 204) {
          continue;
        }
        if (!response.ok) {
          throw new Error(`stream request failed: ${response.status} ${response.statusText}`);
        }

        const frame = (await response.json()) as UiEventFrame;
        if (typeof frame.seq === "number") {
          this.lastSeq = Math.max(this.lastSeq, frame.seq);
        }
        // Contract rule: unknown events are ignored by clients.
        if (isKnownStreamEvent(frame)) {
          this.eventHandlers.forEach((handler) => handler(frame));
        }
      } catch (error) {
        if (this.manuallyClosed) {
          return;
        }
        if ((error as Error).name === "AbortError") {
          return;
        }
        this.emitStatus("error", "realtime stream transport error");
        this.emitStatus("closed");
        this.scheduleReconnect();
        return;
      } finally {
        this.pollAbort = null;
      }
    }
  }

  private toLongPollUrl(since: number): string {
    const base = this.url
      .replace(/^ws:/i, "http:")
      .replace(/^wss:/i, "https:");
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}since=${since}&timeout_ms=25000`;
  }

  private scheduleReconnect(): void {
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts += 1;
    this.emitStatus("connecting", `reconnect in ${delayMs}ms`);
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }
}
