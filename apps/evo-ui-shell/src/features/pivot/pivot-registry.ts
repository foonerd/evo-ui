import type { NavView } from "../../app/nav-types";
import {
  AlarmClock,
  Compass,
  DownloadCloud,
  Heart,
  Home,
  Library,
  ListMusic,
  Settings2,
  Speaker,
  Wrench
} from "lucide-preact";

export type PivotPlane =
  | "listen"
  | "connect"
  | "storage"
  | "automate"
  | "system";

export interface PivotTile {
  readonly id: NavView;
  readonly plane: PivotPlane;
  readonly label: string;
  readonly icon: typeof Home;
  readonly priority: number;
}

/** Initial registry — mirrors App.tsx nav until plugins own registration. */
export const PIVOT_TILES: readonly PivotTile[] = [
  { id: "home", plane: "listen", label: "Home", icon: Home, priority: 0 },
  { id: "library", plane: "listen", label: "Queue", icon: Library, priority: 10 },
  { id: "explore", plane: "listen", label: "Browse", icon: Compass, priority: 20 },
  { id: "playlists", plane: "listen", label: "Playlists", icon: ListMusic, priority: 30 },
  { id: "favourites", plane: "listen", label: "Favourites", icon: Heart, priority: 40 },
  { id: "works", plane: "listen", label: "Works", icon: Library, priority: 50 },
  { id: "multiroom", plane: "connect", label: "Multi-room", icon: Speaker, priority: 10 },
  { id: "system", plane: "system", label: "Settings", icon: Settings2, priority: 10 },
  { id: "operations", plane: "system", label: "Operations", icon: Wrench, priority: 20 },
  { id: "alarm", plane: "system", label: "Alarms", icon: AlarmClock, priority: 30 },
  { id: "update", plane: "system", label: "Update", icon: DownloadCloud, priority: 40 }
];

export function pivotTilesForPlane(
  plane: PivotPlane,
  limit = 8
): readonly PivotTile[] {
  return PIVOT_TILES.filter((tile) => tile.plane === plane)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

export type PivotReveal = "rest" | "track" | "art" | "bio" | "library" | "device";

// revealForDirection RETIRED (2026-07-14): direction -> reveal is no
// longer fixed wiring - it is curated DATA in ui.profile (see
// runtime/compass-map.ts) and PivotHome routes from the resolved
// plan.compass map.
