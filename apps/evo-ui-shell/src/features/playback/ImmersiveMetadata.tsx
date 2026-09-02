// Fullscreen "zoom" of the smart metadata widget. It plays as ONE
// continuous, seamless crawl through every section that has content
// (Artist / Album / Lyrics / Work / Provenance) - exactly like the inline
// smart widget, using the same two-copy transform loop so it never jumps
// (important for photosensitive viewers). The tabs across the top are
// position indicators: they highlight the section currently passing, and
// tapping one jumps the crawl to that section and holds it. A play/pause
// toggle stops/resumes the crawl. Nothing added beyond the widget's own
// content; provenance is a section, not a top bar; lyrics flow in full.
//
// The section set + track_detail are the same the inline widget already
// fetched (passed in), so this issues no second read.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { buildSections, type Section } from "./SmartMetadataWidget";
import { WorkPane } from "./TrackInfoBody";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import type { NowPlaying } from "./now-playing-decoders";
import type { TrackDetail } from "./track-detail-decoders";
import type { TrackDetailPhase } from "./use-track-detail";

export interface ImmersiveMetadataProps {
  onClose: () => void;
  nowPlaying: NowPlaying | null;
  detail: TrackDetail | null;
  phase: TrackDetailPhase;
}

const CRAWL_PX_PER_FRAME = 0.45; // matches the inline smart crawl

export function ImmersiveMetadata({
  onClose,
  nowPlaying,
  detail,
  phase
}: ImmersiveMetadataProps): JSX.Element {
  useLocale();
  const track = nowPlaying?.track ?? null;
  const classical = track?.classical ?? null;

  // Same section builder the inline crawl uses (provenance is a section,
  // never a top bar); Work spliced in for classical tracks.
  const base = buildSections(detail);
  const sections: Section[] =
    classical == null
      ? base
      : (() => {
          const work: Section = {
            key: "work",
            title: t("contextual.tab.work"),
            node: <WorkPane classical={classical} />
          };
          const provIdx = base.findIndex((s) => s.key === "prov");
          return provIdx >= 0
            ? [...base.slice(0, provIdx), work, ...base.slice(provIdx)]
            : [...base, work];
        })();

  const count = sections.length;
  const contentKey = sections.map((s) => s.key).join(",");

  const innerRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef(0);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);

  // Reset when the content set changes (track change).
  useEffect(() => {
    posRef.current = 0;
    activeRef.current = 0;
    setActive(0);
    setHeld(false);
    if (innerRef.current !== null) {
      innerRef.current.style.transform = "translateY(0px)";
    }
  }, [contentKey]);

  // Continuous seamless crawl (two-copy loop). Measured once per run.
  useEffect(() => {
    if (held || count < 1) return undefined;
    const inner = innerRef.current;
    if (inner === null) return undefined;
    const firstCopy = inner.children[0] as HTMLElement | undefined;
    if (firstCopy === undefined) return undefined;

    let oneHeight = 0;
    let offsets: number[] = [];
    const measure = (): void => {
      oneHeight = firstCopy.offsetHeight;
      offsets = Array.from(
        firstCopy.querySelectorAll(".evo-meta-section")
      ).map((el) => (el as HTMLElement).offsetTop);
    };
    measure();

    let raf = 0;
    const tick = (): void => {
      if (oneHeight <= 0) measure(); // layout may settle a frame late
      if (oneHeight > 0) {
        posRef.current += CRAWL_PX_PER_FRAME;
        if (posRef.current >= oneHeight) posRef.current -= oneHeight;
        inner.style.transform = `translateY(${-posRef.current}px)`;
        // Highlight the section currently at the top of the viewport.
        let idx = 0;
        for (let i = 0; i < offsets.length; i++) {
          if (offsets[i] <= posRef.current + 24) idx = i;
        }
        if (idx !== activeRef.current) {
          activeRef.current = idx;
          setActive(idx);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [held, count, contentKey]);

  const jumpTo = (i: number): void => {
    const inner = innerRef.current;
    const firstCopy = inner?.children[0] as HTMLElement | undefined;
    const secs = firstCopy?.querySelectorAll(".evo-meta-section");
    const el = secs?.[i] as HTMLElement | undefined;
    if (el !== undefined && inner !== null) {
      posRef.current = el.offsetTop;
      inner.style.transform = `translateY(${-posRef.current}px)`;
    }
    activeRef.current = i;
    setActive(i);
    setHeld(true);
  };

  const renderCopy = (hidden: boolean): JSX.Element => (
    <div className="evo-meta-copy" aria-hidden={hidden}>
      {sections.map((s) => (
        <div key={s.key} className="evo-meta-section">
          <div className="evo-meta-section-title">{s.title}</div>
          {s.node}
        </div>
      ))}
    </div>
  );

  return (
    <AttentionOverlay
      band="dialog"
      className="evo-immersive-meta"
      role="dialog"
      ariaLabel="Track info"
      onDismiss={onClose}
      dismissOnBackdrop
    >
      <button
        type="button"
        className="evo-immersive-close"
        aria-label="Close track info"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        &times;
      </button>
      <div
        className="evo-immersive-meta-sheet"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="evo-immersive-meta-inner">
          {count > 0 ? (
            <div className="evo-immersive-meta-tabs" role="tablist">
              {sections.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={i === active ? "on" : ""}
                  onClick={() => jumpTo(i)}
                >
                  {s.title}
                </button>
              ))}
              <button
                type="button"
                className="evo-immersive-meta-auto"
                aria-pressed={!held}
                aria-label={held ? "Resume auto-scroll" : "Pause auto-scroll"}
                title={held ? "Resume auto-scroll" : "Pause auto-scroll"}
                onClick={() => setHeld((h) => !h)}
              >
                {held ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <rect x="7" y="4" width="4" height="16" fill="currentColor" />
                    <rect x="13" y="4" width="4" height="16" fill="currentColor" />
                  </svg>
                )}
              </button>
            </div>
          ) : null}
          <div
            className="evo-immersive-meta-pane"
            onClick={() => setHeld(true)}
          >
            {count > 0 ? (
              <div ref={innerRef} className="evo-immersive-meta-crawl">
                {renderCopy(false)}
                {renderCopy(true)}
              </div>
            ) : (
              <p className="contextual-empty">
                {phase === "loading"
                  ? t("contextual.loading")
                  : t("smartwidget.empty")}
              </p>
            )}
          </div>
        </div>
      </div>
    </AttentionOverlay>
  );
}
