// Contract: Save as playlist replaces a name that already exists.
//
// The glass hint says the existing list is replaced. The plugin
// only rm's then save's when overwrite is true; default false
// lets MPD ACK "Playlist already exists" and the list is not
// replaced. The hook must send overwrite: true. playlist_name
// stays that verb's field. create / add / remove / move are
// not this row.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/queue/useAudioQueue.ts");
const surface = src("features/queue/QueueSurface.tsx");
const locales = src("locales/en.ts");

test("saveAsPlaylist sends playlist_name and overwrite: true", () => {
  const block = hook.slice(hook.indexOf("const saveAsPlaylist = useCallback("));
  assert.match(
    block,
    /dispatch\("queue\.save_queue_as_playlist", \{\s*playlist_name: playlistName,\s*overwrite: true\s*\}\)/
  );
  assert.ok(!/overwrite:\s*false/.test(block));
});

test("the save-as dialog paints the replace hint and calls the helper", () => {
  assert.match(locales, /"queue\.saveAsHint": "If a playlist with this name already exists, it will be replaced\."/);
  assert.match(surface, /hint=\{t\("queue\.saveAsHint"\)\}/);
  assert.match(surface, /saveAsPlaylist\(name\)/);
});

test("the plugin replaces only when overwrite is true", (t) => {
  const rs = join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "evo-device-audio",
    "plugins",
    "org.evoframework.playback.mpd",
    "src",
    "queue.rs"
  );
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  assert.match(s, /struct SaveQueueAsPlaylistPayload/);
  assert.match(s, /pub\(crate\) overwrite: bool/);
  const handler = s.slice(s.indexOf("async fn handle_save_queue_as_playlist"));
  const body = handler.slice(0, handler.indexOf("/// `queue.skip_to_next_available`"));
  assert.match(body, /if payload\.overwrite/);
  assert.match(body, /rm_playlist/);
  assert.match(body, /save_playlist/);
});
