export type NavView =
  | "home"
  | "library"
  | "explore"
  | "playlists"
  | "sources"
  | "favourites"
  | "works"
  | "trackinfo"
  | "system"
  | "operations"
  | "multiroom"
  | "alarm"
  | "update"
  // Host view for operator-defined layout-document pages. Which page
  // renders is tracked separately (App's activeDocPage); this value
  // exists so every built-in view conditional stays false while a
  // document page is on screen.
  | "docpage";
