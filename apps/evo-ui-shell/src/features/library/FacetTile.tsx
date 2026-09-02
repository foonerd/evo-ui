// FacetTile - one value in a browse-by-dimension list.
//
// Every facet tile (artist, album, genre, year) carries the unified
// queue/playlist action kebab: Play now / Play next / Add to queue /
// Save as playlist. Album and artist tiles additionally keep their
// artwork actions (Refresh image / Clear cached image) below a divider
// in the same kebab - playback actions on top, artwork maintenance
// under the separator. Artist and album are cover-forward (they render
// cover_url as a plain img with a domain glyph fallback); genre and
// year are value-only labels. Every tile still drills to the value's
// tracks on tap.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  CalendarDays,
  CornerDownRight,
  Disc3,
  ImageOff,
  ListMusic,
  ListPlus,
  Play,
  RefreshCw,
  Tags,
  User
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { t } from "../../runtime/i18n";
import { KebabMenu, type KebabMenuItem } from "../../components/KebabMenu";
import { tryUseFrameworkTransport } from "../../runtime/framework-transport";
import { pluginRequest } from "../../runtime/plugin-request-codec";
import { applyArtworkSize, readArtworkSize } from "./artwork-size";
import type { FacetEntry, FacetKind } from "./library-decoders";

const ARTWORK_SHELF = "artwork.providers";

export type QueueMode = "now" | "next" | "append";

interface ClearTarget {
  verb: string;
  target: { scheme: string; value: string };
}

function hideBrokenImg(e: Event): void {
  (e.currentTarget as HTMLImageElement).style.display = "none";
}

/// Bounded lazy retry for artist portraits only (transient upstream).
const ARTIST_RETRY_DELAYS_MS = [4000, 10000, 25000];

interface FacetTileProps {
  facet: FacetKind;
  entry: FacetEntry;
  viewMode: "list" | "tile";
  busy: boolean;
  onOpen: () => void;
  /** Queue this facet value: replace-and-play / play-next / append. */
  onQueue?: (mode: QueueMode) => void;
  /** Save this facet value's tracks as a playlist. */
  onSave?: () => void;
}

/** The universal queue/playlist actions present on every facet tile. */
function queueItems(
  onQueue: ((m: QueueMode) => void) | undefined,
  onSave: (() => void) | undefined
): KebabMenuItem[] {
  const items: KebabMenuItem[] = [];
  if (onQueue !== undefined) {
    items.push(
      {
        id: "play-now",
        icon: <Play size={14} />,
        label: t("collection.playNow"),
        onSelect: () => onQueue("now")
      },
      {
        id: "play-next",
        icon: <CornerDownRight size={14} />,
        label: t("collection.playNext"),
        onSelect: () => onQueue("next")
      },
      {
        id: "add-queue",
        icon: <ListPlus size={14} />,
        label: t("collection.addToQueue"),
        onSelect: () => onQueue("append")
      }
    );
  }
  if (onSave !== undefined) {
    items.push({
      id: "save-playlist",
      icon: <ListMusic size={14} />,
      label: t("collection.saveAsPlaylist"),
      onSelect: onSave
    });
  }
  return items;
}

export function FacetTile(props: FacetTileProps) {
  const { facet, entry, viewMode, busy, onOpen } = props;
  const cls =
    (viewMode === "tile"
      ? "facet-tile facet-tile-card"
      : "facet-tile facet-tile-row") +
    " facet-tile-" +
    facet;

  if (facet === "artist") {
    return (
      <CoverFacetTile
        {...props}
        cls={cls}
        round
        glyph={<User size={20} />}
        clearTarget={{
          verb: "artwork.online.clear_cache",
          target: { scheme: "artist-name", value: entry.value }
        }}
        artistFallback
      />
    );
  }
  if (facet === "album") {
    const sub = [
      entry.artist,
      entry.trackCount !== null
        ? t("library.trackCount", { n: entry.trackCount })
        : null
    ]
      .filter((v): v is string => v !== null && v.length > 0)
      .join(" - ");
    return (
      <CoverFacetTile
        {...props}
        cls={cls}
        glyph={<Disc3 size={20} />}
        sub={sub !== "" ? sub : undefined}
        clearTarget={{
          verb: "artwork.local.clear_cache",
          target: {
            scheme: "mpd-album",
            value: `${entry.artist ?? ""}|${entry.value}`
          }
        }}
      />
    );
  }

  // Genre / year: value-only label tile + the queue action kebab.
  const icon = facet === "genre" ? <Tags size={20} /> : <CalendarDays size={20} />;
  const items = queueItems(props.onQueue, props.onSave);
  return (
    <div
      className={
        viewMode === "tile"
          ? "facet-tile-wrap facet-tile-wrap-card"
          : "facet-tile-wrap facet-tile-wrap-row"
      }
    >
      <button type="button" className={cls} onClick={onOpen} disabled={busy}>
        <span className="facet-tile-art">{icon}</span>
        <span className="facet-tile-text">
          <span className="facet-tile-title">{entry.value}</span>
        </span>
      </button>
      {items.length > 0 ? (
        <div className="facet-tile-kebab">
          <KebabMenu disabled={busy} items={items} />
        </div>
      ) : null}
    </div>
  );
}

function CoverFacetTile({
  entry,
  cls,
  viewMode,
  busy,
  onOpen,
  round = false,
  glyph,
  sub,
  clearTarget,
  artistFallback = false,
  onQueue,
  onSave
}: FacetTileProps & {
  cls: string;
  round?: boolean;
  glyph: ComponentChildren;
  sub?: string;
  clearTarget: ClearTarget;
  artistFallback?: boolean;
}) {
  const transport = tryUseFrameworkTransport();
  const [nonce, setNonce] = useState(0);
  const [retry, setRetry] = useState(0);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const triedFallback = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    },
    []
  );

  const base =
    entry.coverUrl !== null
      ? applyArtworkSize(entry.coverUrl, readArtworkSize())
      : null;
  const bust =
    nonce > 0 ? `refresh=1&_r=m${nonce}` : retry > 0 ? `_r=r${retry}` : null;
  const primary =
    base === null
      ? null
      : bust === null
        ? base
        : `${base}${base.includes("?") ? "&" : "?"}${bust}`;
  const src = cleared ? null : (fallbackSrc ?? primary);

  const scheduleRetry = (): void => {
    if (!artistFallback || cleared) return;
    if (retry >= ARTIST_RETRY_DELAYS_MS.length) return;
    if (retryTimer.current !== null) return;
    const delay = ARTIST_RETRY_DELAYS_MS[retry];
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      triedFallback.current = false;
      setFallbackSrc(null);
      setRetry((n) => n + 1);
    }, delay);
  };

  const onImgError = (e: Event): void => {
    if (
      artistFallback &&
      transport !== null &&
      fallbackSrc === null &&
      !triedFallback.current
    ) {
      triedFallback.current = true;
      void (async () => {
        const r = await pluginRequest(
          transport,
          ARTWORK_SHELF,
          "artwork.resolve_artist_artwork",
          { v: 1, artist: entry.value }
        );
        const url =
          r.error === undefined &&
          r.value !== null &&
          typeof r.value === "object"
            ? (r.value as Record<string, unknown>)["image_url"]
            : null;
        if (typeof url === "string" && url.length > 0) setFallbackSrc(url);
        else scheduleRetry();
      })();
      return;
    }
    hideBrokenImg(e);
    scheduleRetry();
  };

  const refresh = (): void => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    triedFallback.current = false;
    setFallbackSrc(null);
    setCleared(false);
    setRetry(0);
    setNonce((n) => n + 1);
  };

  const clear = (): void => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (transport !== null) {
      void pluginRequest(transport, ARTWORK_SHELF, clearTarget.verb, {
        v: 1,
        target: clearTarget.target
      });
    }
    triedFallback.current = false;
    setFallbackSrc(null);
    setCleared(true);
  };

  // Kebab: universal queue actions on top, then artwork maintenance
  // under a divider (album + artist only).
  const items: KebabMenuItem[] = [
    ...queueItems(onQueue, onSave),
    {
      id: "refresh",
      icon: <RefreshCw size={14} />,
      label: t("artwork.tile.refresh"),
      separatorBefore: true,
      onSelect: refresh
    },
    {
      id: "clear",
      icon: <ImageOff size={14} />,
      label: t("artwork.tile.clear"),
      onSelect: clear
    }
  ];

  return (
    <div
      className={
        viewMode === "tile"
          ? "facet-tile-wrap facet-tile-wrap-card"
          : "facet-tile-wrap facet-tile-wrap-row"
      }
    >
      <button type="button" className={cls} onClick={onOpen} disabled={busy}>
        <span
          className={
            round ? "facet-tile-art facet-tile-art-round" : "facet-tile-art"
          }
        >
          {glyph}
          {src !== null ? (
            <img src={src} alt="" loading="lazy" onError={onImgError} />
          ) : null}
        </span>
        <span className="facet-tile-text">
          <span className="facet-tile-title">{entry.value}</span>
          {sub !== undefined ? (
            <span className="facet-tile-sub">{sub}</span>
          ) : null}
        </span>
      </button>
      <div className="facet-tile-kebab">
        <KebabMenu disabled={busy} items={items} />
      </div>
    </div>
  );
}
