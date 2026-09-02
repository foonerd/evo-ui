import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { usePlayback } from "./usePlayback";
import {
  interpolateElapsedMs,
  type ElapsedAnchor,
  type TransportState
} from "./now-playing-decoders";
import {
  Heart,
  ListPlus,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from "lucide-preact";
import { useFavourites } from "../favourites/useFavourites";
import { usePlaylists } from "../playlist/usePlaylists";
import { usePresentationPlan } from "../../runtime/presentation-context";
import { rangeFill } from "../../runtime/range-fill";
import { PlaylistPickerDialog } from "../../components/dialogs";
import {
  Visualizer,
  type VisualizerBinCount,
  type VisualizerChannelMode,
  type VisualizerPreset
} from "./Visualizer";
import type { SpectrumFrameBuffers } from "./spectrum-decoders";
import type { VizColorMode, VizPaletteId } from "./viz-palettes";
import { ImmersiveVisualizer } from "./ImmersiveVisualizer";
import { ImmersiveArtwork } from "./ImmersiveArtwork";
import { useArtistImage } from "./use-artist-image";
import type { AudioFormat } from "../audio/stream-format-decoders";
import { formatSourceShort } from "./provenance";
import { ClassicalMetadataStrip } from "../classical/ClassicalMetadataStrip";
import { ScrollingText } from "../../components/ScrollingText";
import type { TextOverflowMode } from "../../components/ScrollingText";
import { HeartbeatMark } from "../../components/HeartbeatMark";
import { PlaybackConnectionChrome } from "./playback-connection-chrome";

interface PlaybackSurfaceProps {
  /** Step for the Volume -/+ buttons, from the central settings. */
  volumeStep: number;
  /** When true, the engineer telemetry block renders on the centre
   *  stage. Off by default; toggled from Settings > System >
   *  Diagnostics. */
  diagnosticsEnabled: boolean;
  // Visualiser preset + enabled + bin_count + channel_mode come in
  // from the central settings state so changes propagate atomically.
  // The optional spectrumFrame ref is the wire-side spectrum source
  // (audio.terminus plugin, audio_playback_spectrum_frame subject)
  // owned by useSpectrum in App.tsx. The Visualizer reads from it
  // when fresh and falls back to a synthesised idle frame
  // otherwise.
  visualizerEnabled: boolean;
  visualizerPreset: VisualizerPreset;
  visualizerBinCount: VisualizerBinCount;
  visualizerChannelMode: VisualizerChannelMode;
  /** Operator sensitivity offset for the wire-driven dB curve,
   *  in dB. Pass-through to Visualizer. */
  visualizerSensitivityDb: number;
  /** Decay speed of the bar fall (1 lazy .. 10 aggressive).
   *  Pass-through to Visualizer. */
  visualizerDecay: number;
  /** Style + palette pickers from the immersive fullscreen visualiser;
   *  persist via App patchUiSettings and fan out live. */
  visualizerOnSelectPreset: (preset: VisualizerPreset) => void;
  visualizerOnSelectPalette: (palette: VizPaletteId) => void;
  /** Colour palette + colour mode (viz-palettes.ts). Pass-through
   *  to Visualizer; (theme, gradient) is the legacy paint. */
  visualizerPalette: VizPaletteId;
  visualizerColorMode: VizColorMode;
  spectrumFrame?: { readonly current: SpectrumFrameBuffers };
  /** Resolved boolean from Settings -> Appearance -> Classical
   *  metadata. False suppresses the strip regardless of tags. */
  showClassicalStrip: boolean;
  /** pivot-rest: legacy combined rest. pivot-track: compact now-playing sheet. */
  variant?: "default" | "pivot-rest" | "pivot-track";
  /** How a long title/artist behaves on the compact surface: a gentle
   *  ticker ("scroll") or a 2-line clamp + ellipsis ("wrap"). Operator
   *  choice; defaults to scroll (reduced-motion falls back to wrap). */
  titleOverflowMode?: TextOverflowMode;
}

export type { PlaybackSurfaceProps };

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function PlaybackSurface({
  volumeStep,
  diagnosticsEnabled,
  visualizerEnabled,
  visualizerPreset,
  visualizerBinCount,
  visualizerChannelMode,
  visualizerSensitivityDb,
  visualizerDecay,
  visualizerOnSelectPreset,
  visualizerOnSelectPalette,
  visualizerPalette,
  visualizerColorMode,
  spectrumFrame,
  showClassicalStrip,
  variant = "default",
  titleOverflowMode = "scroll"
}: PlaybackSurfaceProps) {
  const {
    connection,
    nowPlaying,
    streamFormat,
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    seek,
    setVolume,
    setMute,
    setRepeat,
    setShuffle,
    refreshNowPlaying
  } = usePlayback();
  // Tracks whether a verb dispatch is in flight so transport
  // controls disable for the round-trip - mirrors the prior
  // action.loading gate.
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Compact (pivot-track) surface is plan-aware: the control icons
  // size from the physical touch target, decorative elements gate by
  // height, and art + provenance live on the swipe-left canvas, not
  // here. Functional controls (transport, seek, volume) are never
  // folded away on this surface - their overflow/step-sheet targets
  // do not exist yet, so removing them would be a dead no-op.
  const plan = usePresentationPlan();
  const compact = variant === "pivot-track";
  const planH = plan.effectiveH;
  const iconMain = compact ? Math.max(20, Math.round(plan.touchTargetPx * 0.5)) : 22;
  const iconStd = compact ? Math.max(16, Math.round(plan.touchTargetPx * 0.42)) : 18;
  const iconSm = compact ? Math.max(14, Math.round(plan.touchTargetPx * 0.38)) : 16;
  const showStageArt = !compact;
  const showVisualizer = !compact || planH >= 380;
  const showAlbumLine = !compact || planH >= 360;
  const showClassicalByHeight = !compact || planH >= 360;
  // Secondary transport (shuffle/repeat) folds only when the five
  // buttons physically would not fit at the floored target size -
  // an honest omission on the densest panels (still reachable on
  // larger surfaces), not a fold into a menu that does not exist.
  const showModes = !compact || plan.effectiveW >= plan.touchTargetPx * 5 * 1.25;
  // The +/- volume step buttons are the convenience controls (the
  // slider does the adjusting). On a panel too narrow for the full
  // row they fold away - keeping mute + slider + value, which also
  // preserves the mute==value bookend symmetry. Threshold covers
  // mute + two steps + a usable slider + value + gaps.
  const showVolumeSteps =
    !compact || plan.effectiveW >= plan.touchTargetPx * 3 + 160;

  const lastNonZeroVolumeRef = useRef(40);
  // Optimistic slider positions. A controlled range input bound to
  // the warden's state would snap the thumb back to the old value
  // for the dispatch round-trip, so while a seek or volume change
  // is in flight the slider holds the operator's chosen value. The
  // next now_playing update is authoritative and releases it.
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  const [pendingSeekPercent, setPendingSeekPercent] = useState<
    number | null
  >(null);

  // Favourites integration for the centre-stage heart toggle. The
  // mpdPath on each now-playing track is the URI the favourites
  // shelf indexes on, so set membership is a direct lookup. Adding
  // and removing routes through the same plugin verbs the Library /
  // Queue rows use - the new audio.favourites subject re-emits on
  // success and the heart fills/empties without any local optimism.
  const fav = useFavourites();
  const playlists = usePlaylists();
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [vizImmersive, setVizImmersive] = useState(false);
  const [artZoom, setArtZoom] = useState(false);
  const favouriteUris = useMemo(() => {
    const set = new Set<string>();
    fav.state?.items.forEach((item) => set.add(item.uri));
    return set;
  }, [fav.state]);

  const transportState = nowPlaying?.transportState;
  const track = nowPlaying?.track ?? null;
  // Resolve the artist image only while the fullscreen artwork is open
  // (cache-first; costs nothing when closed or on a repeat artist).
  const artistImageUrl = useArtistImage(artZoom ? track?.artist ?? null : null);
  const volume = nowPlaying?.volume ?? 0;
  const elapsedMs = nowPlaying?.elapsedMs ?? null;
  const durationMs = nowPlaying?.durationMs ?? null;
  const isPlaying = transportState === "playing";
  const shuffleOn = nowPlaying?.shuffle ?? false;
  const repeatOn = nowPlaying?.repeat ?? false;

  // The warden publishes now_playing only on transitions - play /
  // pause / stop / track change / seek / volume - never on the
  // playhead simply advancing, and a fresh page never receives the
  // standing value at all. To keep the progress bar moving between
  // those sparse updates, anchor on each reported position and
  // advance a local clock while playing. Re-anchor synchronously
  // during render whenever the transport state or the reported
  // elapsed value changes, so a paused or seeked frame shows its
  // own position rather than drifting from a stale anchor.
  const anchorKeyRef = useRef<string>("");
  const elapsedAnchorRef = useRef<ElapsedAnchor | null>(null);
  const [, setClockTick] = useState(0);

  const anchorKey = `${transportState ?? "none"}:${elapsedMs ?? "null"}`;
  if (anchorKeyRef.current !== anchorKey) {
    anchorKeyRef.current = anchorKey;
    elapsedAnchorRef.current =
      elapsedMs !== null ? { elapsedMs, atMs: Date.now() } : null;
  }

  // While playing, re-render four times a second so the interpolated
  // position advances on screen between warden updates.
  useEffect(() => {
    if (transportState !== "playing") return;
    const id = window.setInterval(() => {
      setClockTick((t) => (t + 1) % 1_000_000);
    }, 250);
    return () => window.clearInterval(id);
  }, [transportState]);

  const displayElapsedMs =
    elapsedAnchorRef.current === null
      ? 0
      : interpolateElapsedMs(
          elapsedAnchorRef.current,
          Date.now(),
          isPlaying,
          durationMs
        );

  const progressPercent = useMemo(() => {
    if (durationMs === null || durationMs <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, (displayElapsedMs / durationMs) * 100));
  }, [durationMs, displayElapsedMs]);

  // Pegged-bar watchdog: the warden publishes now_playing only on
  // transitions, so if the local wall-clock has interpolated the
  // displayed elapsed past the reported track duration while the
  // transport is still "playing", we have either missed a
  // subject_state_changed happening for a loop / advance, or the
  // warden has not yet published one. Either way the rendered
  // progress is a lie. After a short grace window (long enough
  // that a normal transition publish would have arrived first),
  // fire a one-shot get_now_playing read to pull the warden's
  // current truth and re-anchor the progress clock. No polling in
  // the steady state - this only runs while the invariant
  // "displayed elapsed <= durationMs" is violated.
  const isPegged =
    isPlaying &&
    durationMs !== null &&
    durationMs > 0 &&
    displayElapsedMs >= durationMs;
  const pegKey = isPegged
    ? `${elapsedAnchorRef.current?.elapsedMs ?? "x"}-${durationMs ?? "x"}`
    : "";
  useEffect(() => {
    if (pegKey === "") return;
    const id = window.setTimeout(() => {
      void refreshNowPlaying();
    }, 750);
    return () => window.clearTimeout(id);
  }, [pegKey, refreshNowPlaying]);

  useEffect(() => {
    if (typeof volume === "number" && volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
  }, [volume]);

  // A fresh now_playing update is the authoritative state and
  // supersedes any optimistic slider value still being held.
  useEffect(() => {
    setPendingVolume(null);
    setPendingSeekPercent(null);
  }, [nowPlaying]);

  // Connection states are announced by the heartbeat panel; the
  // feedback line carries verb refusals only - one message, one
  // channel, never both saying the same thing. A refusal is an
  // error by definition.
  const feedbackMessage = feedback;
  const feedbackIsError = feedback !== "";

  // Run a transport verb, gating the controls for the round-trip.
  // On success the feedback line is cleared - the now_playing
  // state is itself the confirmation (the transport reflects the
  // new state). Only an operator-facing refusal is surfaced; a
  // successful command is never echoed onto the centre stage.
  const runVerb = async (
    verb: () => Promise<{ ok: true } | { ok: false; message: string }>
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    setBusy(true);
    try {
      const result = await verb();
      setFeedback(result.ok ? "" : result.message);
      return result;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={
        variant === "pivot-rest"
          ? "card feature-surface playback-surface playback-surface-pivot-rest"
          : variant === "pivot-track"
            ? "card feature-surface playback-surface playback-surface-pivot-track"
            : "card feature-surface playback-surface"
      }
    >
      {/* Loud popup only for real degrade (restart / upgrade /
          disconnect). Healthy F5 "connecting" stays quiet — see
          playback-connection-chrome policy. */}
      <PlaybackConnectionChrome
        connection={connection}
        nowPlaying={nowPlaying}
      />

      <div className="playback-stage">
        {showStageArt ? (
        <div className="playback-stage-art">
          <div
            className={track?.artworkUrl ? "playback-hero-art" : "playback-hero-art playback-hero-art-waiting"}
            role={track?.artworkUrl ? "button" : undefined}
            tabIndex={track?.artworkUrl ? 0 : undefined}
            aria-label={track?.artworkUrl ? "Zoom artwork" : undefined}
            onClick={track?.artworkUrl ? () => setArtZoom(true) : undefined}
            onKeyDown={
              track?.artworkUrl
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setArtZoom(true);
                    }
                  }
                : undefined
            }
          >
            {/* Real album artwork. The now_playing wire carries the
              * resolved artwork_url (decoded to track.artworkUrl); render
              * it as a cover-fitted <img>. On a null URL we skip the img
              * and the gradient placeholder shows through; on a load error
              * we hide the img so the placeholder shows instead. The codec
              * badge + format detail below stay overlaid on top either way. */}
            {track?.artworkUrl ? (
              <img
                className="playback-hero-art-img"
                src={track.artworkUrl}
                alt=""
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <HeartbeatMark />
            )}
            {/* Codec chip + rate/depth detail. Both come from
              * the playback warden's audio_playback_stream_format
              * subject. Each renders only when the wire field is
              * non-null - no static fallback, no path-extension
              * heuristic. The chip shows the source codec family
              * (FLAC / MP3 / DSF / ...); the detail shows rate
              * + bit-depth from the effective format reaching
              * the DAC. */}
            {(streamFormat?.sourceCodec ?? streamFormat?.source?.kind) ? (
              <div className="playback-hero-badge">
                {/* DSD-family files carry source_codec="dsf"|"dff"
                  *  (the container) but source.kind="dsd" (the
                  *  encoding). Audiophile UIs show the encoding -
                  *  "DSD" - which is what the listener cares about.
                  *  For every other codec, source_codec IS the
                  *  meaningful label (FLAC / MP3 / WAV / ...). */}
                {streamFormat.source?.kind === "dsd"
                  ? "DSD"
                  : (streamFormat.sourceCodec ?? "").toUpperCase()}
              </div>
            ) : null}
            {(streamFormat?.source ?? streamFormat?.effective) ? (
              <div className="playback-hero-format">
                {formatSourceShort(
                  (streamFormat?.source ?? streamFormat?.effective) as AudioFormat
                )}
              </div>
            ) : null}
          </div>
        </div>
        ) : null}
        <div className="playback-stage-body">
      <div className="playback-stack">
      <div className="playback-nowplaying">
        {compact ? (
          <>
            {/* Compact surface: title + artist use the operator-selectable
              * scroll/wrap behaviour. Favourite + add-to-playlist are NOT
              * here - they live on the swipe-left art canvas, so the title
              * gets the full width and is never overlaid. */}
            <h2 className="playback-nowplaying-title">
              <ScrollingText
                text={
                  track !== null
                    ? track.title ?? "Unknown Track"
                    : "Nothing playing"
                }
                mode={titleOverflowMode}
                clampLines={2}
              />
            </h2>
            {track !== null && track.artist ? (
              <p className="playback-nowplaying-artist">
                <ScrollingText
                  text={track.artist}
                  mode={titleOverflowMode}
                  clampLines={1}
                />
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="playback-nowplaying-title-row">
              <h2>
                {track !== null
                  ? track.title ?? "Unknown Track"
                  : "Nothing playing"}
              </h2>
              {track !== null && track.mpdPath !== undefined ? (
                (() => {
                  const uri = track.mpdPath;
                  const isFav = favouriteUris.has(uri);
                  return (
                    <span className="playback-nowplaying-title-actions">
                      <button
                        type="button"
                        className={
                          isFav
                            ? "playback-nowplaying-fav playback-nowplaying-fav-on"
                            : "playback-nowplaying-fav"
                        }
                        disabled={busy}
                        aria-pressed={isFav}
                        aria-label={
                          isFav ? "Remove from favourites" : "Add to favourites"
                        }
                        onClick={() => {
                          void runVerb(() =>
                            isFav
                              ? fav.removeFavourite(uri)
                              : fav.addFavourite(uri)
                          );
                        }}
                      >
                        <Heart size={20} fill={isFav ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className="playback-nowplaying-fav"
                        disabled={busy}
                        aria-label="Add to playlist"
                        title="Add to playlist..."
                        onClick={() => setAddToPlaylistOpen(true)}
                      >
                        <ListPlus size={20} />
                      </button>
                    </span>
                  );
                })()
              ) : null}
            </div>
            <p className="playback-nowplaying-artist">
              {track !== null ? track.artist ?? "Unknown Artist" : ""}
            </p>
          </>
        )}
        {showAlbumLine ? (
          <p className="playback-nowplaying-album">
            {track !== null ? track.album ?? "Unknown Album" : ""}
          </p>
        ) : null}
        {showClassicalStrip &&
        showClassicalByHeight &&
        track !== null &&
        track.classical !== null ? (
          <div className="playback-nowplaying-classical classical-strip-host">
            <ClassicalMetadataStrip tags={track.classical} mode={titleOverflowMode} />
          </div>
        ) : null}
      </div>
      {showVisualizer ? (
      <div
        className="playback-visualizer"
        role="button"
        tabIndex={0}
        aria-label="Open fullscreen visualiser"
        onClick={() => setVizImmersive(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setVizImmersive(true);
          }
        }}
      >
        <Visualizer
          enabled={visualizerEnabled}
          preset={visualizerPreset}
          binCount={visualizerBinCount}
          channelMode={visualizerChannelMode}
          heightPx={64}
          frameSource={spectrumFrame}
          sensitivityDb={visualizerSensitivityDb}
          decay={visualizerDecay}
          palette={visualizerPalette}
          colorMode={visualizerColorMode}
        />
      </div>
      ) : null}
      {vizImmersive ? (
        <ImmersiveVisualizer
          onClose={() => setVizImmersive(false)}
          preset={visualizerPreset}
          binCount={visualizerBinCount}
          channelMode={visualizerChannelMode}
          sensitivityDb={visualizerSensitivityDb}
          decay={visualizerDecay}
          palette={visualizerPalette}
          colorMode={visualizerColorMode}
          frameSource={spectrumFrame}
          onSelectPreset={visualizerOnSelectPreset}
          onSelectPalette={visualizerOnSelectPalette}
        />
      ) : null}
      {artZoom && track?.artworkUrl ? (
        <ImmersiveArtwork
          onClose={() => setArtZoom(false)}
          images={[track.artworkUrl, artistImageUrl].filter(
            (u): u is string => typeof u === "string" && u.length > 0
          )}
        />
      ) : null}
      <div className="playback-progress">
        <span>{formatClock(displayElapsedMs)}</span>
        <input
          className="playback-progress-slider"
          style={rangeFill(pendingSeekPercent ?? progressPercent)}
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={pendingSeekPercent ?? progressPercent}
          disabled={busy || durationMs === null || durationMs <= 0}
          onChange={(event) => {
            if (durationMs === null || durationMs <= 0) {
              return;
            }
            const percent = Number((event.currentTarget as HTMLInputElement).value);
            const nextSeekMs = Math.round((percent / 100) * durationMs);
            setPendingSeekPercent(percent);
            void runVerb(() => seek(nextSeekMs)).then((result) => {
              if (!result.ok) setPendingSeekPercent(null);
            });
          }}
          aria-label="Playback progress"
        />
        <span>{durationMs !== null ? formatClock(durationMs) : "0:00"}</span>
      </div>

      <div className="action-row playback-transport-row">
        {showModes ? (
        <button
          type="button"
          className={
            shuffleOn
              ? "playback-transport-icon playback-transport-icon-active"
              : "playback-transport-icon"
          }
          disabled={busy}
          aria-pressed={shuffleOn}
          onClick={() => void runVerb(() => setShuffle(!shuffleOn))}
          aria-label="Shuffle"
        >
          <Shuffle size={iconStd} />
        </button>
        ) : null}
        <button
          type="button"
          className="playback-transport-icon"
          onClick={() => void runVerb(() => previous())}
          disabled={busy}
          aria-label="Previous track"
        >
          <SkipBack size={iconStd} />
        </button>
        <button
          type="button"
          onClick={() =>
            void runVerb(
              isPlaying
                ? () => pause()
                : transportState === "paused"
                  ? () => resume()
                  : () => play()
            )
          }
          disabled={busy}
          className="playback-transport-main playback-transport-icon"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={iconMain} /> : <Play size={iconMain} />}
        </button>
        <button
          type="button"
          className="playback-transport-icon"
          onClick={() => void runVerb(() => next())}
          disabled={busy}
          aria-label="Next track"
        >
          <SkipForward size={iconStd} />
        </button>
        {showModes ? (
        <button
          type="button"
          className={
            repeatOn
              ? "playback-transport-icon playback-transport-icon-active"
              : "playback-transport-icon"
          }
          disabled={busy}
          aria-pressed={repeatOn}
          onClick={() => void runVerb(() => setRepeat(!repeatOn))}
          aria-label="Repeat"
        >
          <Repeat size={iconStd} />
        </button>
        ) : null}
      </div>

      <div className="playback-volume-row">
        <button
          type="button"
          className="playback-volume-icon"
          disabled={busy}
          onClick={() => {
            const muted = nowPlaying?.muted ?? volume === 0;
            if (!muted && volume > 0) {
              lastNonZeroVolumeRef.current = volume;
            }
            void runVerb(() => setMute(!muted));
          }}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? <VolumeX size={iconStd} /> : <Volume2 size={iconStd} />}
        </button>
        {showVolumeSteps ? (
        <button
          type="button"
          className="playback-volume-step"
          disabled={busy}
          onClick={() => {
            const target = Math.max(0, (pendingVolume ?? volume) - volumeStep);
            setPendingVolume(target);
            void runVerb(() => setVolume(target)).then((result) => {
              if (!result.ok) setPendingVolume(null);
            });
          }}
          aria-label="Volume down"
        >
          <Minus size={iconSm} />
        </button>
        ) : null}
        <input
          className="playback-volume-slider"
          style={rangeFill(pendingVolume ?? volume)}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pendingVolume ?? volume}
          disabled={busy}
          onChange={(event) => {
            const target = Number((event.currentTarget as HTMLInputElement).value);
            setPendingVolume(target);
            void runVerb(() => setVolume(target)).then((result) => {
              if (!result.ok) setPendingVolume(null);
            });
          }}
          aria-label="Volume"
        />
        {showVolumeSteps ? (
        <button
          type="button"
          className="playback-volume-step"
          disabled={busy}
          onClick={() => {
            const target = Math.min(100, (pendingVolume ?? volume) + volumeStep);
            setPendingVolume(target);
            void runVerb(() => setVolume(target)).then((result) => {
              if (!result.ok) setPendingVolume(null);
            });
          }}
          aria-label="Volume up"
        >
          <Plus size={iconSm} />
        </button>
        ) : null}
        <span className="playback-volume-value">
          {pendingVolume ?? volume}%
        </span>
      </div>
      </div>
        </div>
      </div>
      {diagnosticsEnabled ? (
        <div className="queue-state playback-telemetry">
        {nowPlaying ? (
          <>
            <div>
              <strong>Status:</strong> {nowPlaying.transportState}
            </div>
            <div>
              <strong>Track:</strong> {track?.title ?? "Unknown"} -{" "}
              {track?.artist ?? "Unknown"}
            </div>
            <div>
              <strong>Connection:</strong> {connection.kind}
            </div>
            <div>
              <strong>Volume:</strong> {nowPlaying.volume}{" "}
              {nowPlaying.muted ? "(muted)" : ""}
            </div>
            <div>
              <strong>Modes:</strong> repeat {nowPlaying.repeat ? "on" : "off"},
              shuffle {nowPlaying.shuffle ? "on" : "off"}
            </div>
          </>
        ) : (
          "No playback state received yet."
        )}
        </div>
      ) : null}
      {feedbackMessage ? (
        <p className={feedbackIsError ? "playback-feedback playback-feedback-error" : "playback-feedback"}>
        {feedbackMessage || " "}
        </p>
      ) : null}
      {addToPlaylistOpen && track !== null ? (
        <PlaylistPickerDialog
          title="Add to playlist"
          hint={`"${track.title ?? track.mpdPath}" will be appended to the selected playlist.`}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel="Add"
          onCancel={() => setAddToPlaylistOpen(false)}
          onConfirm={(name) => {
            const uri = track.mpdPath;
            setAddToPlaylistOpen(false);
            void runVerb(async () => {
              const r = await playlists.addToPlaylist(name, [uri]);
              if (r.ok) return { ok: true };
              return { ok: false, message: r.message };
            });
          }}
        />
      ) : null}
    </section>
  );
}
