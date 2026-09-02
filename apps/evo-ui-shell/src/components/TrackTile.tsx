// TrackTile - the ONE shared track row/card renderer.
//
// Every collection surface that lists tracks (queue, playlist
// detail, home-rail coming-next) renders this component instead of
// hand-rolling its own row markup. It owns: the artwork thumbnail
// (img with onError falling back to the neutral placeholder square -
// same pattern as the StageSurface art atom), the ellipsised title,
// the artist/album line, the optional classical strip, and the
// duration. Surfaces inject their own controls via the `leading`,
// `badges` and `actions` slots so behaviour stays per-surface while
// the shape stays shared.
//
// Two shapes:
//   "row"  - horizontal list row (44px thumb; `dense` shrinks it to
//            32px for compact strips like the home rail).
//   "card" - vertical tile for the tile view mode (full-width square
//            art, duration folded into the tertiary line, leading +
//            actions merged into one footer row).
//
// Primary action ("play this"): when `onPrimaryAction` is provided,
// the title becomes the tap target in row shape and the artwork
// becomes the tap target in card shape - mirroring the pre-unification
// queue behaviours exactly.

import type { ComponentChildren } from "preact";
import { formatDurationMs } from "../features/queue/audio-queue-decoders";
import { ClassicalMetadataStrip } from "../features/classical/ClassicalMetadataStrip";
import type { ClassicalTags } from "../features/classical/classical-tags";
import { ScrollingText, type TextOverflowMode } from "./ScrollingText";

export interface TrackTileProps {
  shape: "row" | "card";
  title: string;
  artist?: string | null;
  album?: string | null;
  /** Resolved artwork URL (decoders' artworkUrl). null / undefined
   *  shows the neutral placeholder square. Decorative: empty alt. */
  artworkUrl?: string | null;
  /** Glyph rendered inside the placeholder square (theme domain
   *  icon, ListMusic, ...). Sits under the artwork img; a failed
   *  img load reveals it. */
  placeholderIcon?: ComponentChildren;
  /** Pre-gated classical tags - the caller passes null when the
   *  classical strip device setting is off. */
  classical?: ClassicalTags | null;
  /** undefined = surface has no duration cell (compact strips).
   *  null renders the "-" fallback via formatDurationMs. */
  durationMs?: number | null;
  /** Extra tertiary text (codec, unavailable) - card shape only,
   *  appended after the duration. */
  tertiary?: string | null;
  /** Currently-playing highlight. */
  current?: boolean;
  /** Known-unreachable dimming (available === false only - null
   *  truth renders neutrally per the cascade contract). */
  unavailable?: boolean;
  /** Compact row variant for tight strips (32px thumb). */
  dense?: boolean;
  /** RESOLVED long-text behaviour for title + secondary line (the
   *  per-surface Aa override already resolved against the device
   *  Long text setting). Containment is unconditional: whatever the
   *  mode, both lines render through ScrollingText inside
   *  overflow-hidden boxes and can never widen the tile. Default
   *  truncate (single line + ellipsis). */
  textMode?: TextOverflowMode;
  /** Leading slot (row shape: before the thumb - position label,
   *  reorder buttons; card shape: merged into the actions row). */
  leading?: ComponentChildren;
  /** Badge slot rendered after the text in row shape (codec /
   *  UNAVAIL chips). */
  badges?: ComponentChildren;
  /** Trailing per-surface controls. */
  actions?: ComponentChildren;
  /** "Play this" tap: row shape wires it to the title, card shape
   *  to the artwork. Absent = plain text / plain art. */
  onPrimaryAction?: () => void;
  primaryActionDisabled?: boolean;
  /** aria-label for the primary-action button. */
  primaryActionLabel?: string;
  /** title tooltip for the primary-action button. */
  primaryActionTitle?: string;
}

function hideBrokenImg(e: Event): void {
  (e.currentTarget as HTMLImageElement).style.display = "none";
}

export function TrackTile({
  shape,
  title,
  artist = null,
  album = null,
  artworkUrl = null,
  placeholderIcon,
  classical = null,
  durationMs,
  tertiary = null,
  current = false,
  unavailable = false,
  dense = false,
  textMode = "truncate",
  leading,
  badges,
  actions,
  onPrimaryAction,
  primaryActionDisabled = false,
  primaryActionLabel,
  primaryActionTitle
}: TrackTileProps) {
  const className = [
    "track-tile",
    shape === "card" ? "track-tile-card" : "track-tile-row",
    dense ? "track-tile-dense" : "",
    current ? "track-tile-current" : "",
    unavailable ? "track-tile-unavailable" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const art = (
    <>
      {placeholderIcon}
      {artworkUrl !== null ? (
        <img
          className="track-tile-thumb-img"
          src={artworkUrl}
          alt=""
          loading="lazy"
          onError={hideBrokenImg}
        />
      ) : null}
    </>
  );

  const thumb =
    shape === "card" && onPrimaryAction !== undefined ? (
      <button
        type="button"
        className="track-tile-thumb"
        onClick={onPrimaryAction}
        disabled={primaryActionDisabled}
        aria-label={primaryActionLabel}
        title={primaryActionTitle}
      >
        {art}
      </button>
    ) : (
      <div className="track-tile-thumb" aria-hidden="true">
        {art}
      </div>
    );

  // Title + secondary render through ScrollingText UNCONDITIONALLY
  // (ruled): scroll = gentle ticker, wrap = 2-line clamp, truncate =
  // single-line ellipsis - text can never escape or widen the tile.
  const titleText = <ScrollingText text={title} mode={textMode} clampLines={2} />;
  const titleNode =
    shape === "row" && onPrimaryAction !== undefined ? (
      <button
        type="button"
        className="track-tile-title"
        onClick={onPrimaryAction}
        disabled={primaryActionDisabled}
        aria-label={primaryActionLabel}
        title={primaryActionTitle}
      >
        {titleText}
      </button>
    ) : (
      <div className="track-tile-title">{titleText}</div>
    );

  const secondary =
    artist !== null || album !== null
      ? [artist, album].filter((v) => v !== null).join(" - ")
      : null;

  // Card shape folds the duration into the tertiary line (the row
  // shape keeps its dedicated trailing duration cell).
  const cardTertiary =
    shape === "card"
      ? [
          durationMs !== undefined ? formatDurationMs(durationMs) : null,
          tertiary
        ]
          .filter((v) => v !== null)
          .join(" - ")
      : "";

  const text = (
    <div className="track-tile-text">
      {titleNode}
      {secondary !== null ? (
        <div className="track-tile-secondary">
          <ScrollingText text={secondary} mode={textMode} clampLines={2} />
        </div>
      ) : null}
      {classical !== null ? (
        <div className="track-tile-secondary classical-strip-host">
          <ClassicalMetadataStrip tags={classical} mode={textMode} />
        </div>
      ) : null}
      {shape === "card" && cardTertiary !== "" ? (
        <div className="track-tile-tertiary">{cardTertiary}</div>
      ) : null}
    </div>
  );

  if (shape === "card") {
    return (
      <div className={className}>
        {thumb}
        {text}
        {leading !== undefined || actions !== undefined ? (
          <div className="track-tile-actions">
            {leading}
            {actions}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      {leading !== undefined ? (
        <div className="track-tile-leading">{leading}</div>
      ) : null}
      {thumb}
      {text}
      {badges !== undefined ? (
        <div className="track-tile-badges">{badges}</div>
      ) : null}
      {durationMs !== undefined ? (
        <div className="track-tile-duration">{formatDurationMs(durationMs)}</div>
      ) : null}
      {actions !== undefined ? (
        <div className="track-tile-actions">{actions}</div>
      ) : null}
    </div>
  );
}
