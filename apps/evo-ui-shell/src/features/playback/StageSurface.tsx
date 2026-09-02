// StageSurface - the now-playing stage rendered from a StageDoc:
// rows -> weighted cells -> atom stacks, every placement operator
// data. Parallel to the legacy PlaybackSurface monolith (kept for
// revert); the shipped CLASSIC_STAGE arrangement reproduces it.
//
// One usePlayback instance + one busy gate serve every atom, so the
// exploded console still acts as one console. Atoms reuse the
// monolith's class names wherever the piece is the same control -
// same look, same theme obedience, no parallel styling truth.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";
import {
  Heart,
  Menu,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-preact";

import {
  CLASSIC_STAGE,
  STAGE_CONTRACT_ATOMS,
  stageNodeCss,
  type StageBlock,
  type StageDoc,
} from "../../runtime/stage-document";
import { usePlayback } from "./usePlayback";
import { interpolateElapsedMs } from "./now-playing-decoders";
import { useFavourites } from "../favourites/useFavourites";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { rangeFill } from "../../runtime/range-fill";
import { Visualizer } from "./Visualizer";
import { ImmersiveVisualizer } from "./ImmersiveVisualizer";
import { ImmersiveArtwork } from "./ImmersiveArtwork";
import { useArtistImage } from "./use-artist-image";
import { formatSourceShort } from "./provenance";
import type { PlaybackSurfaceProps } from "./PlaybackSurface";
import { ClassicalMetadataStrip } from "../classical/ClassicalMetadataStrip";
import { ScrollingText } from "../../components/ScrollingText";
import { HeartbeatMark } from "../../components/HeartbeatMark";
import { PlaybackConnectionChrome } from "./playback-connection-chrome";
import { useTrackDetail } from "./use-track-detail";
import { MetadataSection } from "./MetadataSection";
import { LyricsBlock } from "./LyricsBlock";
import { ProvenanceBlock, hasProvenance } from "./ProvenanceBlock";
import { SmartCrawl } from "./SmartMetadataWidget";
import { TrackInfoBody } from "./TrackInfoBody";

interface ElapsedAnchor {
  elapsedMs: number;
  atMs: number;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type StageSurfaceProps = Omit<PlaybackSurfaceProps, "variant"> & {
  readonly stage?: StageDoc | null;
  /** False when the menu is PINNED chrome - the nav atom then has
   *  nothing to toggle and renders disabled (no silent no-op
   *  affordances, by the honour-the-flows rule). Default true. */
  readonly navToggleAvailable?: boolean;
};

export function StageSurface(props: StageSurfaceProps) {
  const stage = props.stage ?? CLASSIC_STAGE;
  useLocale(); // re-render on language switch - strings go through t()
  const {
    connection,
    nowPlaying, streamFormat,
    pause, resume, next, previous, seek,
    setVolume, setMute, setRepeat, setShuffle, setSingle,
    refreshNowPlaying,
  } = usePlayback();
  const [busy, setBusy] = useState(false);
  const [pendingSeekPercent, setPendingSeekPercent] = useState<number | null>(null);
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  const [vizImmersive, setVizImmersive] = useState(false);
  const [artZoom, setArtZoom] = useState(false);
  const fav = useFavourites();

  const track = nowPlaying?.track ?? null;
  const artistImageUrl = useArtistImage(artZoom ? track?.artist ?? null : null);
  // One track_detail read per stage - passed into every meta atom so a
  // stage with several of them issues a single fetch.
  const { detail, phase: detailPhase } = useTrackDetail(track?.mpdPath ?? null);
  const detailLoading = detailPhase === "loading";
  // Stage meta atoms route the "add a key" CTA to the credentials screen
  // via an app-level event (App listens), mirroring the menu-toggle path.
  const openMetaCredentials = () =>
    window.dispatchEvent(new Event("evo:open-metadata-credentials"));
  const transportState = nowPlaying?.transportState;
  const isPlaying = transportState === "playing";
  const volume = pendingVolume ?? nowPlaying?.volume ?? 0;
  const durationMs = nowPlaying?.durationMs ?? null;
  const elapsedMs = nowPlaying?.elapsedMs ?? null;
  const shuffleOn = nowPlaying?.shuffle ?? false;
  const repeatOn = nowPlaying?.repeat ?? false;
  const singleOn = nowPlaying?.single ?? false;

  // Interpolated playhead between the warden's sparse now_playing
  // transitions - same anchor-and-tick approach as the monolith.
  const anchorKeyRef = useRef("");
  const anchorRef = useRef<ElapsedAnchor | null>(null);
  const [, setTick] = useState(0);
  const anchorKey = `${transportState ?? "none"}:${elapsedMs ?? "null"}`;
  if (anchorKeyRef.current !== anchorKey) {
    anchorKeyRef.current = anchorKey;
    anchorRef.current = elapsedMs !== null ? { elapsedMs, atMs: Date.now() } : null;
  }
  useEffect(() => {
    if (transportState !== "playing") return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % 1e6), 250);
    return () => window.clearInterval(id);
  }, [transportState]);
  // Shared clamping interpolator (parity with the monolith): now_playing
  // is transition-only, so between the warden's sparse updates we advance
  // locally, capped at the duration - a missed / late end-of-track
  // transition can no longer show nonsense like 108:02 against a 5:21
  // track.
  const displayElapsed =
    anchorRef.current === null
      ? 0
      : interpolateElapsedMs(
          anchorRef.current,
          Date.now(),
          isPlaying,
          durationMs
        );
  const progressPercent =
    durationMs !== null && durationMs > 0
      ? Math.min(100, (displayElapsed / durationMs) * 100)
      : 0;

  // Pegged-bar watchdog (parity with the monolith): if the interpolated
  // playhead has reached the duration while still "playing", a now_playing
  // transition was missed or is late. After a short grace, pull the
  // warden's truth once to re-anchor - no steady-state polling.
  const isPegged =
    isPlaying &&
    durationMs !== null &&
    durationMs > 0 &&
    displayElapsed >= durationMs;
  const pegKey = isPegged
    ? `${anchorRef.current?.elapsedMs ?? "x"}-${durationMs}`
    : "";
  useEffect(() => {
    if (pegKey === "") return undefined;
    const id = window.setTimeout(() => {
      void refreshNowPlaying();
    }, 750);
    return () => window.clearTimeout(id);
  }, [pegKey, refreshNowPlaying]);

  // Release optimistic holds when authority catches up.
  useEffect(() => {
    if (pendingVolume !== null && nowPlaying?.volume === pendingVolume) {
      setPendingVolume(null);
    }
  }, [nowPlaying?.volume, pendingVolume]);
  useEffect(() => { setPendingSeekPercent(null); }, [elapsedMs]);

  const runVerb = async (verb: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await verb(); } finally { setBusy(false); }
  };

  const favUris = useMemo(() => {
    const set = new Set<string>();
    fav.state?.items.forEach((item) => set.add(item.uri));
    return set;
  }, [fav.state]);
  const trackUri = track?.mpdPath ?? null;
  const isFav = trackUri !== null && favUris.has(trackUri);

  const scaleCls = (b: StageBlock) => ` st-s${b.scale ?? 2}`;
  // Long-text behaviour (scroll / wrap / truncate) applies to EVERY
  // design, not only the pivot compact surface (ruled).
  const overflow = props.titleOverflowMode ?? "scroll";

  function renderAtom(b: StageBlock, key: string) {
    switch (b.kind) {
      case "title":
        return (
          <h2 key={key} class={"playback-nowplaying-title st-title" + scaleCls(b)}>
            <ScrollingText text={track == null ? t("stage.nothingPlaying") : (track.title ?? t("stage.untitled"))} mode={overflow} clampLines={2} />
          </h2>
        );
      case "artist":
        return (
          <p key={key} class={"playback-nowplaying-artist st-artist" + scaleCls(b)}>
            <ScrollingText text={track?.artist ?? ""} mode={overflow} clampLines={2} />
          </p>
        );
      case "album":
        return (
          <p key={key} class={"playback-nowplaying-album st-album" + scaleCls(b)}>
            <ScrollingText text={track?.album ?? ""} mode={overflow} clampLines={1} />
          </p>
        );
      case "classical":
        return props.showClassicalStrip && track !== null && track.classical !== null ? (
          <div key={key} class="playback-nowplaying-classical classical-strip-host">
            <ClassicalMetadataStrip tags={track.classical} mode={overflow} />
          </div>
        ) : null;
      case "art":
        // Pure artwork - codec and bitrate are DECOUPLED atoms by
        // ruling; nothing rides on the art any more.
        return (
          <Fragment key={key}>
            <div
              class={"playback-hero-art st-art" + scaleCls(b) + (track?.artworkUrl ? "" : " playback-hero-art-waiting")}
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
              {track?.artworkUrl ? (
                <img
                  class="playback-hero-art-img"
                  src={track.artworkUrl}
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <HeartbeatMark />
              )}
            </div>
            {artZoom && track?.artworkUrl ? (
              <ImmersiveArtwork
                onClose={() => setArtZoom(false)}
                images={[track.artworkUrl, artistImageUrl].filter(
                  (u): u is string => typeof u === "string" && u.length > 0
                )}
              />
            ) : null}
          </Fragment>
        );
      case "viz":
        return (
          <Fragment key={key}>
            <div
              class={"playback-visualizer st-viz" + scaleCls(b)}
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
                enabled={props.visualizerEnabled}
                preset={props.visualizerPreset}
                binCount={props.visualizerBinCount}
                channelMode={props.visualizerChannelMode}
                heightPx={(b.scale ?? 2) === 1 ? 36 : (b.scale ?? 2) === 3 ? 128 : 64}
                frameSource={props.spectrumFrame}
                sensitivityDb={props.visualizerSensitivityDb}
                decay={props.visualizerDecay}
                palette={props.visualizerPalette}
                colorMode={props.visualizerColorMode}
              />
            </div>
            {vizImmersive ? (
              <ImmersiveVisualizer
                onClose={() => setVizImmersive(false)}
                preset={props.visualizerPreset}
                binCount={props.visualizerBinCount}
                channelMode={props.visualizerChannelMode}
                sensitivityDb={props.visualizerSensitivityDb}
                decay={props.visualizerDecay}
                palette={props.visualizerPalette}
                colorMode={props.visualizerColorMode}
                frameSource={props.spectrumFrame}
                onSelectPreset={props.visualizerOnSelectPreset}
                onSelectPalette={props.visualizerOnSelectPalette}
              />
            ) : null}
          </Fragment>
        );
      case "progress":
        return (
          <div key={key} class={"playback-progress st-progress" + scaleCls(b)}>
            <span>{clock(displayElapsed)}</span>
            <input
              class="playback-progress-slider"
              style={rangeFill(pendingSeekPercent ?? progressPercent)}
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={pendingSeekPercent ?? progressPercent}
              disabled={busy || durationMs === null || durationMs <= 0}
              onChange={(e) => {
                if (durationMs === null || durationMs <= 0) return;
                const pct = Number((e.currentTarget as HTMLInputElement).value);
                setPendingSeekPercent(pct);
                void runVerb(() => seek(Math.round((pct / 100) * durationMs)));
              }}
              aria-label={t("stage.seek")}
            />
            <span>{durationMs !== null ? clock(durationMs) : "-:--"}</span>
          </div>
        );
      case "play":
        return (
          <button key={key} type="button"
            class={"playback-transport-main playback-transport-icon st-btn" + scaleCls(b)}
            disabled={busy}
            aria-label={isPlaying ? t("stage.pause") : t("stage.play")}
            onClick={() => void runVerb(() => (isPlaying ? pause() : resume()))}>
            {isPlaying ? <Pause /> : <Play />}
          </button>
        );
      case "prev":
        return (
          <button key={key} type="button" class={"playback-transport-icon st-btn" + scaleCls(b)}
            disabled={busy} aria-label={t("stage.previous")}
            onClick={() => void runVerb(() => previous())}><SkipBack /></button>
        );
      case "next":
        return (
          <button key={key} type="button" class={"playback-transport-icon st-btn" + scaleCls(b)}
            disabled={busy} aria-label={t("stage.next")}
            onClick={() => void runVerb(() => next())}><SkipForward /></button>
        );
      case "shuffle":
        return (
          <button key={key} type="button"
            class={"playback-transport-icon st-btn st-toggle" + (shuffleOn ? " st-on" : "") + scaleCls(b)}
            disabled={busy} aria-label={t("stage.shuffle")} aria-pressed={shuffleOn}
            onClick={() => void runVerb(() => setShuffle(!shuffleOn))}><Shuffle /></button>
        );
      case "repeatAll":
        return (
          <button key={key} type="button"
            class={"playback-transport-icon st-btn st-toggle" + (repeatOn ? " st-on" : "") + scaleCls(b)}
            disabled={busy} aria-label={t("stage.repeat")} aria-pressed={repeatOn}
            onClick={() => void runVerb(() => setRepeat(!repeatOn))}><Repeat /></button>
        );
      case "repeat1":
        // Repeat-one drives the REAL wire verb: set_single (the
        // warden's single-track flag), lit from nowPlaying.single.
        // The old code toggled repeat-all behind a "1" glyph with a
        // stale "verb does not exist" comment - review finding.
        return (
          <button key={key} type="button"
            class={"playback-transport-icon st-btn st-toggle" + (singleOn ? " st-on" : "") + scaleCls(b)}
            disabled={busy} aria-label={t("stage.repeatOne")} aria-pressed={singleOn}
            onClick={() => void runVerb(() => setSingle(!singleOn))}><Repeat1 /></button>
        );
      case "fav":
        // The ACCEPTED favourite affordance (monolith title row):
        // chromeless heart that fills when favourited - never the
        // transport ring (the ringed variant is not shipped).
        return (
          <button key={key} type="button"
            class={"playback-nowplaying-fav" + (isFav ? " playback-nowplaying-fav-on" : "") + scaleCls(b)}
            disabled={busy || trackUri === null}
            aria-label={isFav ? t("stage.favRemove") : t("stage.favAdd")} aria-pressed={isFav}
            onClick={() => {
              if (trackUri === null) return;
              void runVerb(() =>
                isFav ? fav.removeFavourite(trackUri) : fav.addFavourite(trackUri)
              );
            }}><Heart size={b.scale === 1 ? 16 : b.scale === 3 ? 26 : 20} fill={isFav ? "currentColor" : "none"} /></button>
        );
      case "volume":
        return (
          <div key={key} class={"playback-volume-row st-volume" + scaleCls(b)}>
            <button type="button" class="playback-volume-icon" aria-label={t("stage.mute")}
              disabled={busy} onClick={() => void runVerb(() => setMute(volume > 0))}>
              <Volume2 size={16} />
            </button>
            <input class="playback-volume-slider" style={rangeFill(volume)} type="range" min={0} max={100} step={1}
              value={volume} disabled={busy} aria-label={t("stage.volume")}
              onChange={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                setPendingVolume(v);
                void runVerb(() => setVolume(v));
              }} />
            <span class="playback-volume-value">{volume}%</span>
          </div>
        );
      case "codec": {
        const label = streamFormat?.source?.kind === "dsd"
          ? "DSD"
          : (streamFormat?.sourceCodec ?? "").toUpperCase();
        return label ? (
          <div key={key} class={"st-sticker" + scaleCls(b)}><span>{label}</span></div>
        ) : null;
      }
      case "bitrate": {
        const f = streamFormat?.source ?? streamFormat?.effective;
        return f ? (
          <div key={key} class={"st-sticker" + scaleCls(b)}><span>{formatSourceShort(f)}</span></div>
        ) : null;
      }
      case "spacer":
        // Structural spacing as content: consumes its share of the
        // line, renders nothing. The designer draws it hatched.
        return <span key={key} class={"st-spacer" + scaleCls(b)} aria-hidden />;
      case "nav": {
        // Menu icon as placeable content: drives the SAME drawer the
        // fab drives (one mechanism), via the app-level toggle event.
        // When the menu is PINNED there is no drawer to toggle - the
        // button renders disabled instead of silently no-opping.
        const available = props.navToggleAvailable ?? true;
        return (
          <button key={key} type="button"
            class={"playback-transport-icon st-btn" + scaleCls(b)}
            aria-label={t("stage.menuOpen")} disabled={!available}
            title={available ? undefined : t("stage.menuPinned")}
            onClick={() => window.dispatchEvent(new Event("evo:toggle-menu"))}>
            <Menu />
          </button>
        );
      }
      case "bio":
        return (
          <div key={key} class={"st-meta" + scaleCls(b)}>
            <MetadataSection
              source={detail?.artistBio ?? null}
              emptyKey="contextual.noBio"
              loading={detailLoading}
              onOpenCredentials={openMetaCredentials}
            />
          </div>
        );
      case "notes":
        return (
          <div key={key} class={"st-meta" + scaleCls(b)}>
            <MetadataSection
              source={detail?.albumNotes ?? null}
              emptyKey="contextual.noNotes"
              loading={detailLoading}
              onOpenCredentials={openMetaCredentials}
            />
          </div>
        );
      case "lyrics":
        return (
          <div key={key} class={"st-meta" + scaleCls(b)}>
            <LyricsBlock detail={detail} loading={detailLoading} />
          </div>
        );
      case "provenance":
        return (
          <div key={key} class={"st-meta" + scaleCls(b)}>
            {hasProvenance(detail?.reconciliation ?? null) ? (
              <ProvenanceBlock reconciliation={detail?.reconciliation ?? null} />
            ) : (
              <p class="contextual-empty">
                {detailLoading
                  ? t("contextual.loading")
                  : t("contextual.noProvenance")}
              </p>
            )}
          </div>
        );
      case "tabbed":
        return (
          <div key={key} class={"st-meta st-meta-tabbed" + scaleCls(b)}>
            <TrackInfoBody
              classical={track?.classical ?? null}
              detail={detail}
              loading={detailLoading}
              onOpenCredentials={openMetaCredentials}
            />
          </div>
        );
      case "smart":
        return (
          <div key={key} class={"st-meta st-meta-smart" + scaleCls(b)}>
            <SmartCrawl
              nowPlaying={nowPlaying}
              detail={detail}
              phase={detailPhase}
              expandable
            />
          </div>
        );
      default:
        return null;
    }
  }

  const HA: Record<string, string> = {
    left: "flex-start", center: "center", right: "flex-end", justify: "space-between",
  };
  const VA: Record<string, string> = {
    top: "flex-start", center: "center", bottom: "flex-end",
  };

  // v2.1 full controls: pad / scale / style resolve through the SAME
  // mapper the designer canvas uses (stageNodeCss) - designer truth
  // IS glass truth.
  //
  // Always paint the stage chrome. Connection/degraded is an
  // announcement (non-scrim), never a blank/null-gated surface —
  // player appliance: exact-or-degraded, always available.
  return (
    <>
      <PlaybackConnectionChrome
        connection={connection}
        nowPlaying={nowPlaying}
      />
      <div class="stage-rows" data-stage-sections={stage.sections.length}>
        {stage.sections.map((section, s) => (
          <div
            key={`s${s}`}
            class="stage-section"
            style={{ flexGrow: section.weight, ...stageNodeCss(section) }}
            data-fold-priority={section.foldPriority}
          >
            {section.cols.map((column, c) => (
              <div
                key={`c${c}`}
                class="stage-col"
                style={{ flexGrow: column.weight, flexBasis: 0, ...stageNodeCss(column) }}
              >
                {column.rows.map((rw, r) => (
                  <div
                    key={`r${r}`}
                    class="stage-vrow"
                    style={{ flexGrow: rw.weight, ...stageNodeCss(rw) }}
                  >
                    {rw.cells.map((cl, l) => (
                      <div
                        key={`l${l}`}
                        class="stage-cell stage-cell-inline"
                        style={{
                          flexGrow: cl.weight,
                          flexBasis: 0,
                          justifyContent: HA[cl.ha ?? "center"],
                          alignItems: VA[cl.va ?? "center"],
                          alignContent: VA[cl.va ?? "center"],
                          ...stageNodeCss(cl),
                        }}
                      >
                        {cl.atoms.map((b, i) => renderAtom(b, `b${s}.${c}.${r}.${l}.${i}`))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
