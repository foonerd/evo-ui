// Tier 2 audio-reference widget components.
//
// Mirrors the Tier 2 widget-kind declarations the audio reference
// device (evo-device-audio) registers on the framework's widget
// kind registry. Six kinds — transport / queue / metering / browse
// / search / signal-path — each backed by a Preact component
// that consumes the shared runtime context, reads the subject
// store for live state, and dispatches operator-driven mutations
// through the generated SDK.
//
// Architectural note: long-term the audio components live in the
// `evo-device-audio-ui` repository (its own deployable shell that
// admits as a `kind = "UiShell"` artefact). The components below
// are the first concrete reference implementation; they migrate
// over with the file paths intact when the device-tier shell
// repository becomes a deployable app.

import type { ComponentChildren, JSX } from "preact";
import { useComputed } from "@preact/signals";

import { useRuntime } from "../context";
import type { Subject } from "../subjects";
import type { WidgetProps } from "./registry";

/** Audio-tier widget-kind ids. Mirror Rust-side constants. */
export const KIND_PLAYER_TRANSPORT = "audio.player.transport";
export const KIND_QUEUE_LIST = "audio.queue.list";
export const KIND_METERING_PEAK = "audio.metering.peak";
export const KIND_BROWSE_TREE_ENTRY = "audio.browse.tree.entry";
export const KIND_SEARCH_UNIFIED = "audio.search.unified";
export const KIND_SIGNAL_PATH = "audio.signal_path";

function AudioWidgetCard(props: {
  title: string;
  subtitle?: string;
  kind: string;
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <article
      class={`evo-widget evo-widget--audio evo-widget--${slug(props.kind)}`}
      data-widget-kind={props.kind}
    >
      <header class="evo-widget__header">
        <h3 class="evo-widget__title">{props.title}</h3>
        {props.subtitle !== undefined && (
          <p class="evo-widget__subtitle">{props.subtitle}</p>
        )}
      </header>
      {props.children !== undefined && (
        <div class="evo-widget__body">{props.children}</div>
      )}
      <footer class="evo-widget__footer">
        <code class="evo-widget__kind">{props.kind}</code>
      </footer>
    </article>
  );
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/**
 * Reactive lookup of the active-playback subject. The audio
 * reference plugin set publishes a singleton `audio.playback`
 * subject whose state mirrors the current track + playback state;
 * components hold a `Subject | undefined` and re-render reactively
 * via `useComputed`.
 */
function useActivePlaybackSubject(): Subject | undefined {
  const runtime = useRuntime();
  const subjects = useComputed(() => {
    return runtime.subjects.byType("audio.playback")[0];
  });
  return subjects.value;
}

// --- audio.player.transport ------------------------------------

/**
 * Transport-controls widget. Renders the current track / playback
 * state and operator-driven play / pause / next / previous /
 * seek controls. Dispatch routes through the generated SDK so
 * vendor distributions consuming the same shell pick up the
 * implementation automatically.
 */
export function WidgetPlayerTransport(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const subject = useActivePlaybackSubject();
  const state = subject?.state as Record<string, unknown> | undefined;
  const title = (state?.title as string | undefined) ?? "-";
  const artist = (state?.artist as string | undefined) ?? "-";
  const playing =
    (state?.playback_state as string | undefined) === "playing";

  const dispatch = async (verb: string): Promise<void> => {
    await runtime.client.plugins.courseCorrect({
      verb,
      target: "audio.playback",
    });
  };

  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title="Playback"
      subtitle={
        state === undefined
          ? "Waiting for first audio.playback subject update."
          : `${title} - ${artist}`
      }
    >
      <div class="evo-audio__transport-controls">
        <button
          type="button"
          class="evo-audio__transport-prev"
          onClick={() => void dispatch("previous")}
        >
          Prev
        </button>
        <button
          type="button"
          class="evo-audio__transport-play"
          onClick={() => void dispatch(playing ? "pause" : "play")}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          class="evo-audio__transport-next"
          onClick={() => void dispatch("next")}
        >
          Next
        </button>
      </div>
    </AudioWidgetCard>
  );
}

// --- audio.queue.list ------------------------------------------

/**
 * Queue-list widget. Reads the active queue subject's state and
 * renders the list of items. Operator-driven reorder / remove
 * dispatches through the SDK at a later iteration; this pass
 * lands the read path.
 */
export function WidgetQueueList(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const queue = useComputed(() => {
    const subjects = runtime.subjects.byType("audio.queue");
    if (subjects.length === 0) return [] as readonly QueueItem[];
    const state = subjects[0].state as Record<string, unknown> | null;
    const items = state?.items;
    if (!Array.isArray(items)) return [] as readonly QueueItem[];
    return items
      .map((item): QueueItem | null => {
        if (typeof item !== "object" || item === null) return null;
        const o = item as Record<string, unknown>;
        return {
          id: (o.id as string) ?? (o.uri as string) ?? "",
          title: (o.title as string) ?? "",
          artist: (o.artist as string) ?? "",
        };
      })
      .filter((q): q is QueueItem => q !== null);
  });
  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title="Queue"
      subtitle={`${queue.value.length} item${queue.value.length === 1 ? "" : "s"}`}
    >
      {queue.value.length === 0 ? (
        <p class="evo-audio__queue-empty">Queue is empty.</p>
      ) : (
        <ol class="evo-audio__queue-list">
          {queue.value.map((item) => (
            <li key={item.id} class="evo-audio__queue-item">
              <span class="evo-audio__queue-title">{item.title || "-"}</span>
              <span class="evo-audio__queue-artist">
                {item.artist || ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </AudioWidgetCard>
  );
}

interface QueueItem {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
}

// --- audio.metering.peak ---------------------------------------

/**
 * Peak-meter widget. Renders an L / R peak indicator from the
 * metering subject's state. Bars are CSS-styled height percentages
 * driven by the subject's `peak_l` / `peak_r` values in dBFS
 * (0 = silence; 1.0 = full scale).
 */
export function WidgetMeteringPeak(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const meter = useComputed(() => {
    const subject = runtime.subjects.byType("audio.metering")[0];
    if (subject === undefined) return { l: 0, r: 0 };
    const state = subject.state as Record<string, unknown> | null;
    const l = clamp01(state?.peak_l);
    const r = clamp01(state?.peak_r);
    return { l, r };
  });
  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title="Peak meter"
      subtitle={`L ${pct(meter.value.l)} · R ${pct(meter.value.r)}`}
    >
      <div class="evo-audio__meter">
        <div
          class="evo-audio__meter-bar"
          style={`height:${pct(meter.value.l)}`}
          aria-label={`Left peak ${pct(meter.value.l)}`}
        />
        <div
          class="evo-audio__meter-bar"
          style={`height:${pct(meter.value.r)}`}
          aria-label={`Right peak ${pct(meter.value.r)}`}
        />
      </div>
    </AudioWidgetCard>
  );
}

function clamp01(v: unknown): number {
  if (typeof v !== "number") return 0;
  if (Number.isNaN(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// --- audio.browse.tree.entry -----------------------------------

/**
 * Browse-tree-entry widget. The browse surface is hierarchical
 * (artists → albums → tracks). Each stocking is one entry; the
 * envelope's parameters carry the entry's id + label. The
 * renderer drives navigation through hash-route deep-linking
 * so back / forward / share-by-URL all work.
 */
export function WidgetBrowseTreeEntry(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const label = stringEnvField(props, "label") || "Browse";
  const targetUri = stringEnvField(props, "uri");
  const onActivate = (): void => {
    if (targetUri !== "") {
      void runtime.client.plugins.courseCorrect({
        verb: "play_now",
        uri: targetUri,
      });
    }
  };
  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title={label}
      subtitle={targetUri || "no target URI declared"}
    >
      <button
        type="button"
        class="evo-audio__browse-activate"
        onClick={() => onActivate()}
        disabled={targetUri === ""}
      >
        Play
      </button>
    </AudioWidgetCard>
  );
}

// --- audio.search.unified --------------------------------------

/**
 * Unified-search widget. Operator types into a text field; the
 * widget dispatches search-class verbs against the metadata chain
 * through the SDK. This pass lands the input surface; result
 * resolution drives off the chain's response shape.
 */
export function WidgetSearchUnified(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const dispatchSearch = (query: string): void => {
    if (query.trim().length === 0) return;
    void runtime.client.plugins.courseCorrect({
      verb: "search",
      query,
    });
  };
  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title="Search"
      subtitle="Unified search across artists / albums / tracks / podcasts."
    >
      <input
        type="search"
        class="evo-audio__search-input"
        placeholder="Search…"
        onKeyDown={(e) => {
          if ((e as KeyboardEvent).key === "Enter") {
            dispatchSearch((e.currentTarget as HTMLInputElement).value);
          }
        }}
      />
    </AudioWidgetCard>
  );
}

// --- audio.signal_path -----------------------------------------

/**
 * Signal-path widget. Reads the audio.topology subject and
 * renders the active routing chain — source → composition →
 * delivery → endpoint — alongside its bit-perfect score. Vendor
 * distributions extending the chain (e.g. dedicated DSP modules)
 * surface their stages here automatically via the topology
 * subject's state.
 */
export function WidgetSignalPath(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const path = useComputed(() => {
    const subject = runtime.subjects.byType("audio.topology")[0];
    if (subject === undefined) return null;
    const state = subject.state as Record<string, unknown> | null;
    if (state === null || state === undefined) return null;
    const stages = state.signal_path;
    return Array.isArray(stages) ? (stages as unknown[]) : null;
  });
  return (
    <AudioWidgetCard
      kind={props.widgetKindId}
      title="Signal path"
      subtitle={
        path.value === null
          ? "audio.topology subject not yet published."
          : `${path.value.length} stage${path.value.length === 1 ? "" : "s"}`
      }
    >
      {path.value !== null && path.value.length > 0 && (
        <ol class="evo-audio__signal-path">
          {path.value.map((stage, i) => (
            <li key={i} class="evo-audio__signal-stage">
              {renderStage(stage)}
            </li>
          ))}
        </ol>
      )}
    </AudioWidgetCard>
  );
}

function renderStage(stage: unknown): string {
  if (typeof stage === "string") return stage;
  if (typeof stage === "object" && stage !== null) {
    const o = stage as Record<string, unknown>;
    const name = (o.name as string) ?? (o.kind as string) ?? "stage";
    const detail = o.format !== undefined ? ` (${String(o.format)})` : "";
    return `${name}${detail}`;
  }
  return String(stage);
}

function stringEnvField(props: WidgetProps, key: string): string {
  const v = props.envelope[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}
