// Contract: Sources does not stay on Connecting after the device
// is Connected, and a long mount is a large heartbeat, not a badge.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  foldEventsIntoStates,
  preferFresherShareState,
  shareStateFromEvent,
  sourcesHeartbeat
} from "../../src/features/sources/share-state-live.ts";
import type { ShareEventItem, ShareStateInfo } from "../../src/features/sources/share-decoders.ts";
import { en } from "../../src/locales/en.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

function info(
  shareId: string,
  state: ShareStateInfo["state"],
  at: number | null
): ShareStateInfo {
  return {
    shareId,
    state,
    reason: null,
    negotiated: null,
    lastTransitionAtMs: at
  };
}

test("a late get_state does not overwrite a newer Connected happening", () => {
  const held = preferFresherShareState(
    new Map([["a", info("a", "mounted", 200)]]),
    info("a", "mounting", 100)
  );
  assert.equal(held.get("a")?.state, "mounted");
});

test("a newer Connected happening replaces Connecting", () => {
  const held = preferFresherShareState(
    new Map([["a", info("a", "mounting", 100)]]),
    info("a", "mounted", 200)
  );
  assert.equal(held.get("a")?.state, "mounted");
});

test("a mounted event paints Connected without a refresh", () => {
  const ev: ShareEventItem = {
    shareId: "a",
    alias: "NFS",
    kind: "mounted",
    detail: null,
    negotiatedVersion: "nfsvers=4",
    atMs: 300
  };
  const held = foldEventsIntoStates(new Map([["a", info("a", "mounting", 100)]]), [
    ev
  ]);
  assert.equal(held.get("a")?.state, "mounted");
  assert.equal(shareStateFromEvent(ev).state, "mounted");
});

test("Connecting is a large heartbeat, not a mute badge", () => {
  assert.deepEqual(
    sourcesHeartbeat(false, [{ alias: "NFFS", state: "mounting" }]),
    { kind: "mounting", alias: "NFFS" }
  );
  assert.deepEqual(sourcesHeartbeat(true, [{ alias: "NFFS", state: "mounted" }]), {
    kind: "working"
  });
  assert.equal(sourcesHeartbeat(false, [{ alias: "NFFS", state: "mounted" }]), null);
});

test("the hook listens on subscribe_happenings for share state", () => {
  const hook = src("features/sources/useNetworkShares.ts");
  assert.match(hook, /subscribe\(\s*"subscribe_happenings"/);
  assert.match(hook, /decodeShareStateHappening/);
  assert.match(hook, /preferFresherShareState/);
  assert.match(hook, /SHARE_STATE_POLL_MS/);
});

test("Sources paints HeartbeatPanel while Connecting", () => {
  const surface = src("features/sources/SourcesSurface.tsx");
  assert.match(surface, /sourcesHeartbeat\(/);
  assert.match(surface, /HeartbeatPanel/);
  assert.match(surface, /sources\.heartbeat\.connecting/);
  assert.equal(en["sources.heartbeat.connecting"], "Connecting {alias}");
  assert.ok(en["sources.heartbeat.connectingDetail"].length > 0);
});
