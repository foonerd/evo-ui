// Smart metadata - the lean-back, ambient view. A seamless continuous
// crawl (two-copy loop, no jump) that cycles the sections that have
// content: artist bio, album notes, lyrics, provenance. Each section
// carries its source attribution inline (name + QR). Tap pauses so a QR
// can be scanned; empty sections are skipped; reduced-motion falls back to
// manual scroll.
//
// SmartCrawl is PRESENTATIONAL - it takes an already-fetched track_detail
// + phase and never fetches, so a stage that hosts it (plus other meta
// atoms) issues a single track_detail read. SmartMetadataWidget is the
// page-widget card wrapper that does the fetch. Honest states: loading,
// then either content or an explicit "no metadata" - never a permanent
// spinner on a finished miss.

import { useEffect, useRef, useState } from "preact/hooks";
import { Fragment } from "preact";
import { useLocale } from "../../runtime/use-locale";
import { ImmersiveMetadata } from "./ImmersiveMetadata";
import { t } from "../../runtime/i18n";
import { useTrackDetail, type TrackDetailPhase } from "./use-track-detail";
import { AttributionLine } from "./AttributionLine";
import { lrcToPlain } from "./LyricsBlock";
import { ProvenanceBlock, hasProvenance } from "./ProvenanceBlock";
import type { NowPlaying } from "./now-playing-decoders";
import type {
  EnrichmentSource,
  EnrichmentSourceEntry,
  TrackDetail
} from "./track-detail-decoders";

function textEntries(src: EnrichmentSource | null): EnrichmentSourceEntry[] {
  if (src === null) return [];
  const entries =
    src.sources.length > 0
      ? src.sources
      : src.text !== null
        ? [
            {
              providerId: src.providerId,
              privacyClass: src.privacyClass,
              attribution: src.attribution,
              text: src.text,
              sourceUrl: src.sourceUrl
            }
          ]
        : [];
  return entries.filter((e) => e.text !== null && e.text.length > 0);
}

export interface Section {
  key: string;
  title: string;
  node: preact.ComponentChildren;
}

export function buildSections(detail: TrackDetail | null): Section[] {
  const out: Section[] = [];
  if (detail === null) return out;

  const prose = (src: EnrichmentSource | null): preact.ComponentChildren =>
    textEntries(src).map((e, i) => (
      <div key={`${e.providerId ?? "s"}-${i}`} className="smart-source">
        <p className="contextual-text">{e.text}</p>
        <AttributionLine attribution={e.attribution} />
      </div>
    ));

  if (textEntries(detail.artistBio).length > 0) {
    out.push({ key: "bio", title: t("contextual.tab.artist"), node: prose(detail.artistBio) });
  }
  if (textEntries(detail.albumNotes).length > 0) {
    out.push({ key: "album", title: t("contextual.tab.album"), node: prose(detail.albumNotes) });
  }
  const l = detail.lyrics;
  const lyricsText =
    l.status === "ok"
      ? l.plain !== null && l.plain.length > 0
        ? l.plain
        : l.synced !== null && l.synced.length > 0
          ? lrcToPlain(l.synced)
          : null
      : null;
  if (lyricsText !== null && lyricsText.length > 0) {
    out.push({
      key: "lyrics",
      title: t("contextual.tab.lyrics"),
      node: (
        <div className="smart-source">
          <pre className="contextual-lyrics">{lyricsText}</pre>
          <AttributionLine
            attribution={
              l.sourceUrl !== null
                ? { sourceName: "LRCLIB", sourceUrl: l.sourceUrl, license: "" }
                : null
            }
          />
        </div>
      )
    });
  }
  if (hasProvenance(detail.reconciliation)) {
    out.push({
      key: "prov",
      title: t("metawidget.provenance"),
      node: <ProvenanceBlock reconciliation={detail.reconciliation} />
    });
  }
  return out;
}

export function SmartCrawl({
  nowPlaying,
  detail,
  phase,
  expandable = false
}: {
  nowPlaying: NowPlaying | null;
  detail: TrackDetail | null;
  phase: TrackDetailPhase;
  /** When set, a tap opens the fullscreen Track Info zoom instead of the
   *  inline pause-to-scan. Passed by the stage atom + the page widget;
   *  the compass bio reveal leaves it off and keeps pause. */
  expandable?: boolean;
}) {
  useLocale();
  const track = nowPlaying?.track ?? null;

  const innerRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const reduced =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const sections = buildSections(detail);
  const contentKey = sections.map((s) => s.key).join(",");

  useEffect(() => {
    if (reduced) return undefined;
    const inner = innerRef.current;
    if (inner === null) return undefined;
    const first = inner.querySelector(
      ".smart-crawl-copy"
    ) as HTMLElement | null;
    let raf = 0;
    let pos = 0;
    const oneHeight = first !== null ? first.offsetHeight : 0;
    const tick = (): void => {
      if (!pausedRef.current && oneHeight > 0) {
        pos += 0.45;
        if (pos >= oneHeight) pos -= oneHeight;
        inner.style.transform = `translateY(${-pos}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, contentKey]);

  if (track === null) {
    return <p className="feature-description">{t("trackinfo.nothing")}</p>;
  }
  if (phase === "loading") {
    return <p className="contextual-empty">{t("contextual.loading")}</p>;
  }
  if (sections.length === 0) {
    return <p className="contextual-empty">{t("smartwidget.empty")}</p>;
  }

  const copy = (hidden: boolean) => (
    <div className="smart-crawl-copy" aria-hidden={hidden}>
      {sections.map((s) => (
        <div key={s.key} className="smart-section">
          <div className="smart-section-title">{s.title}</div>
          {s.node}
        </div>
      ))}
    </div>
  );

  return (
    <Fragment>
      <div
        className={
          reduced ? "smart-crawl-view smart-crawl-view-static" : "smart-crawl-view"
        }
        onClick={() => {
          if (!reduced) setPaused((p) => !p);
        }}
      >
        <div ref={innerRef} className="smart-crawl-inner">
          {copy(false)}
          {reduced ? null : copy(true)}
        </div>
        {expandable ? (
          <button
            type="button"
            className="smart-crawl-expand"
            aria-label={t("smartwidget.title")}
            onClick={(e) => {
              e.stopPropagation();
              setZoom(true);
            }}
          >
            &#10530;
          </button>
        ) : null}
        {paused && !reduced ? (
          <span className="smart-paused">{t("smartwidget.paused")}</span>
        ) : null}
      </div>
      {expandable && zoom ? (
        <ImmersiveMetadata
          onClose={() => setZoom(false)}
          nowPlaying={nowPlaying}
          detail={detail}
          phase={phase}
        />
      ) : null}
    </Fragment>
  );
}

export function SmartMetadataWidget({
  nowPlaying
}: {
  nowPlaying: NowPlaying | null;
}) {
  useLocale();
  const track = nowPlaying?.track ?? null;
  const { detail, phase } = useTrackDetail(track?.mpdPath ?? null);
  return (
    <section className="card feature-surface">
      <div className="feature-head">
        <div>
          <h3>{t("smartwidget.title")}</h3>
        </div>
      </div>
      <SmartCrawl nowPlaying={nowPlaying} detail={detail} phase={phase} expandable />
    </section>
  );
}
