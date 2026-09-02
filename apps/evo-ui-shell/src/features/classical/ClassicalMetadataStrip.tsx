// Compact one-line strip rendered under any track-bearing row when
// the framework reports classical metadata. Empty fields are skipped
// silently; the strip degrades from "all four populated" down to
// "composer only". Mounted on Queue / Favourites / Playlist contents
// / Library file rows / Playback centre stage.
//
// Overflow is owned by ScrollingText (same scroll/wrap/truncate contract
// as title/artist/album). The strip used to be raw inline spans, so long
// lines clipped statically with no ticker.

import type { JSX } from "preact";
import {
  ScrollingText,
  type TextOverflowMode
} from "../../components/ScrollingText";
import { classicalYear, type ClassicalTags } from "./classical-tags";

interface ClassicalMetadataStripProps {
  tags: ClassicalTags;
  /** Long-text mode; default scroll (stage / now-playing). Lists pass their Aa mode. */
  mode?: TextOverflowMode;
}

export function ClassicalMetadataStrip({
  tags,
  mode = "scroll"
}: ClassicalMetadataStripProps): JSX.Element {
  const year = classicalYear(tags);
  const parts: string[] = [];
  if (tags.composer !== null) parts.push(tags.composer);
  if (tags.conductor !== null) {
    parts.push(year !== null ? `${tags.conductor} (${year})` : tags.conductor);
  } else if (year !== null) {
    parts.push(`(${year})`);
  }
  if (tags.ensemble !== null) parts.push(tags.ensemble);
  if (tags.performer !== null && tags.conductor === null) {
    parts.push(tags.performer);
  }
  if (tags.label !== null) parts.push(tags.label);
  const text = parts.join(" / ");
  return (
    <ScrollingText text={text} mode={mode} clampLines={1} className="classical-strip">
      {parts.map((p, i) => (
        <span key={i} className="classical-strip-part">
          {i > 0 ? <span className="classical-strip-sep"> / </span> : null}
          {p}
        </span>
      ))}
    </ScrollingText>
  );
}
