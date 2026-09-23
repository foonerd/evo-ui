// THE browse kebab. Every Folder / Artist / Album / Genre / Year /
// file tile paints this list, in this order. Artwork refresh / clear
// are not in this list - CoverFacetTile appends those after a
// divider and they are not restyled here.

import { CirclePlus, CornerDownRight, ListMusic, ListPlus, ListX, Play } from "lucide-preact";
import { t } from "../../runtime/i18n";
import type { KebabMenuItem } from "../../components/KebabMenu";

export const BROWSE_KEBAB_QUEUE_IDS = [
  "play-now",
  "play-next",
  "add-queue",
  "clear-and-play",
  "add-to-playlist",
  "save-playlist"
] as const;

/** Queue intent on a browse tile. `now` appends and plays the
 *  first new item (live queue kept). `replace` is Clear and play
 *  (queue scope): wipe the live queue, load this selection, play. */
export type BrowseQueueMode = "now" | "next" | "append" | "replace";

export interface BrowseQueueKebabHandlers {
  onQueue: (mode: BrowseQueueMode) => void;
  onAddToPlaylist: () => void;
  onSave: () => void;
}

/** Six operator verbs. Callers that cannot supply every handler
 *  must not paint a kebab - a partial list is how coverage went
 *  random. */
export function browseQueueKebabItems(
  handlers: BrowseQueueKebabHandlers
): KebabMenuItem[] {
  return [
    {
      id: "play-now",
      icon: <Play size={14} />,
      label: t("collection.playNow"),
      onSelect: () => handlers.onQueue("now")
    },
    {
      id: "play-next",
      icon: <CornerDownRight size={14} />,
      label: t("collection.playNext"),
      onSelect: () => handlers.onQueue("next")
    },
    {
      id: "add-queue",
      icon: <ListPlus size={14} />,
      label: t("collection.addToQueue"),
      onSelect: () => handlers.onQueue("append")
    },
    {
      id: "clear-and-play",
      icon: <ListX size={14} />,
      label: t("collection.clearAndPlay"),
      onSelect: () => handlers.onQueue("replace")
    },
    {
      id: "add-to-playlist",
      icon: <CirclePlus size={14} />,
      label: t("collection.addToPlaylist"),
      onSelect: handlers.onAddToPlaylist
    },
    {
      id: "save-playlist",
      icon: <ListMusic size={14} />,
      label: t("collection.saveAsPlaylist"),
      onSelect: handlers.onSave
    }
  ];
}
