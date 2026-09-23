// FacetTile - one value in a browse-by-dimension list.
//
// Every facet tile (artist, album, genre, year) carries THE browse
// kebab from browse-kebab.tsx (Play now / Play next / Add to queue /
// Clear and play / Add to playlist / Save as playlist). Album and
// artist tiles additionally keep their artwork actions (Refresh
// image / Clear cached image) below a divider in the same kebab -
// playback actions on top, artwork maintenance under the separator.
// Those two artwork rows are not restyled. Artist and album are
// cover-forward (they render cover_url as a plain img with a domain
// glyph fallback); genre and year are value-only labels. Every tile
// still drills to the value's tracks on tap.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  CalendarDays,
  Disc3,
  ImageOff,
  RefreshCw,
  Tags,
  User
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { t } from "../../runtime/i18n";
import { KebabMenu, type KebabMenuItem } from "../../components/KebabMenu";
import {
  browseQueueKebabItems,
  type BrowseQueueMode
} from "./browse-kebab";
import { applyArtworkSize, clearArtwork, readArtworkSize } from "./artwork-size";
import { useArtworkResolvedTick } from "./artwork-resolved";
import type { FacetEntry, FacetKind } from "./library-decoders";

export type QueueMode = BrowseQueueMode;

interface ClearTarget {
  verb: string;
  target: { scheme: string; value: string };
}

interface FacetTileProps {
  facet: FacetKind;
  entry: FacetEntry;
  viewMode: "list" | "tile";
  busy: boolean;
  onOpen: () => void;
  /** Queue this facet value: play-now / play-next / append / replace. */
  onQueue?: (mode: QueueMode) => void;
  /** Save this facet value's tracks as a new playlist. */
  onSave?: () => void;
  /** Append this facet value's tracks to an existing playlist. */
  onAddToPlaylist?: () => void;
}

/** THE browse kebab, or nothing. A partial handler set does not
 *  paint a random subset. */
function queueItems(
  onQueue: ((m: QueueMode) => void) | undefined,
  onSave: (() => void) | undefined,
  onAddToPlaylist: (() => void) | undefined
): KebabMenuItem[] {
  if (
    onQueue === undefined ||
    onSave === undefined ||
    onAddToPlaylist === undefined
  ) {
    return [];
  }
  return browseQueueKebabItems({ onQueue, onSave, onAddToPlaylist });
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
  const items = queueItems(props.onQueue, props.onSave, props.onAddToPlaylist);
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
  onQueue,
  onSave,
  onAddToPlaylist
}: FacetTileProps & {
  cls: string;
  round?: boolean;
  glyph: ComponentChildren;
  sub?: string;
  clearTarget: ClearTarget;
}) {
  const [nonce, setNonce] = useState(0);
  const [cleared, setCleared] = useState(false);
  // Broken is managed in state (not by mutating the img's style) so that
  // changing src - via Refresh or a landing after Clear - always gets a
  // fresh load attempt. Mutating style.display made a recovered image
  // stay invisible, which is why Refresh appeared to do nothing.
  const [broken, setBroken] = useState(false);
  // Monotonic cache-bust for a plain re-request when a resolve lands
  // (Step B). Distinct from `nonce` (manual Refresh), which forces a
  // forget via refresh=1; a landing re-request must NOT forget.
  const [reloadTick, setReloadTick] = useState(0);

  const base =
    entry.coverUrl !== null
      ? applyArtworkSize(entry.coverUrl, readArtworkSize())
      : null;
  // Manual Refresh forces a forget + re-resolve (refresh=1). A resolve
  // landing (Step B) only needs a fresh load attempt, NOT a forget - so it
  // adds a distinct cache-bust (_t) that re-requests without evicting.
  const bustParts: string[] = [];
  if (nonce > 0) bustParts.push(`refresh=1&_r=m${nonce}`);
  if (reloadTick > 0) bustParts.push(`_t=${reloadTick}`);
  const primary =
    base === null
      ? null
      : bustParts.length === 0
        ? base
        : `${base}${base.includes("?") ? "&" : "?"}${bustParts.join("&")}`;
  // Paint ONLY the validated serve path (the byte endpoint). There is no
  // second paint path: the tile never renders a raw provider URL from the
  // resolve verb (that was the UI half of the two-winner-path divergence -
  // it repainted the exact silhouette the serve path rejected). When the
  // serve path has no validated image the tile shows the glyph, so a
  // placeholder/rejected result reads as an honest blank.
  const src = cleared ? null : primary;

  // Any src change (Refresh, the fallback landing, Clear-then-Refresh) is a
  // fresh load attempt, so clear the broken flag and let the new URL try.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  // A failed load shows the glyph immediately (never a broken-image mark)
  // and STAYS a glyph. The tile does not retry, classify, or re-fetch on
  // its own - a transient failure is not chased here, which is what
  // prevents a per-tile resolve storm and the repaint loop. The tile waits
  // for the resolve-landed signal (Step B) to bump the tick and re-request.
  // It never paints a raw provider URL, only the validated byte endpoint.
  const onImgError = (): void => {
    setBroken(true);
  };

  // Step B: a resolve landed for this subject on the bus. Lift the
  // operator-cleared blank and any failed-load glyph, then re-request
  // the byte URL in place. Clear latches `cleared` so the old image
  // cannot flash back; a landing is the new image, so that latch drops
  // here. Refresh is not required. Only acts on a real bump.
  const resolvedTick = useArtworkResolvedTick(entry.coverUrl);
  const prevResolvedTick = useRef(resolvedTick);
  useEffect(() => {
    if (resolvedTick === prevResolvedTick.current) return;
    prevResolvedTick.current = resolvedTick;
    setCleared(false);
    setBroken(false);
    setReloadTick((r) => r + 1);
  }, [resolvedTick]);

  const refresh = (): void => {
    setBroken(false);
    setCleared(false);
    setNonce((n) => n + 1);
  };

  const clear = (): void => {
    // Targeted eviction via the one authenticated destructive gesture:
    // DELETE removes this subject's resolve-index entry, asset bytes and
    // plugin memo across all tiers at once. Blank the tile ONLY on a real
    // success - a capability refusal must not leave a glyph implying the
    // image was cleared when it was not.
    void (async (): Promise<void> => {
      const r = await clearArtwork(clearTarget.target);
      if (r.ok) setCleared(true);
    })();
  };

  // Kebab: universal queue actions on top, then artwork maintenance
  // under a divider (album + artist only).
  const items: KebabMenuItem[] = [
    ...queueItems(onQueue, onSave, onAddToPlaylist),
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
          {src !== null && !broken ? (
            <img key={src} src={src} alt="" loading="lazy" onError={onImgError} />
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
