// Contract: the glass that submitted Add share lists and answers the
// password card on the SAME connection that dispatched the verb.
//
// The seat socket is a different connection. Listing only there is
// silence: the submitter cannot find its own card. Add / mount stay
// on the shares write socket (one request). This pin goes RED if that
// write socket is not registered as origin, RED if add/mount leave
// that socket, RED if a write-listed card is answered on the seat
// socket. File-sharing PasswordField stays held.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyOriginWriteList,
  mergePromptLists,
  promptAnswerOnWrite,
  promptKey
} from "../../src/features/prompts/prompt-origin-write.ts";
import { RESPONDER_NOT_GRANTED } from "../../src/features/prompts/origin-list.ts";
import type { PromptItem } from "../../src/features/prompts/prompt-decoders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");

const item = (plugin: string, promptId: string): PromptItem =>
  ({
    plugin,
    promptId,
    promptType: { kind: "password", label: "x" },
    errorContext: null,
    sessionId: null
  }) as PromptItem;

test("mergePromptLists: write-origin cards first; seat extras after; no duplicate", () => {
  const write = [item("org.evoframework.network.shares", "a")];
  const seat = [
    item("org.evoframework.network.shares", "a"),
    item("other", "b")
  ];
  const merged = mergePromptLists(write, seat);
  assert.deepEqual(
    merged.map((p) => promptKey(p)),
    ["org.evoframework.network.shares#a", "other#b"]
  );
});

test("a write-listed card answers on the write socket, not the seat socket", () => {
  const keys = new Set(["org.evoframework.network.shares#a"]);
  assert.equal(promptAnswerOnWrite(item("org.evoframework.network.shares", "a"), keys), true);
  assert.equal(promptAnswerOnWrite(item("other", "b"), keys), false);
});

test("write-socket list: silence is empty; a failure keeps what landed; a list replaces", () => {
  const prev = [item("org.evoframework.network.shares", "a")];
  assert.deepEqual(
    applyOriginWriteList(prev, {
      error: { code: "permission_denied", subclass: RESPONDER_NOT_GRANTED }
    }, () => prev),
    []
  );
  assert.equal(
    applyOriginWriteList(prev, { error: { code: "connection_closed" } }, () => null).length,
    1
  );
  const next = [item("org.evoframework.network.shares", "b")];
  assert.deepEqual(
    applyOriginWriteList(prev, { value: next }, (raw) => raw as PromptItem[]),
    next
  );
});

test("PIN: Add and mount stay one request on the shares write socket; that socket is origin", () => {
  const shares = src("features/sources/useNetworkShares.ts");
  const hook = src("features/prompts/usePromptResponder.ts");
  assert.match(shares, /registerOriginWriteTransport\(ORIGIN_WRITE_ID/);
  assert.match(shares, /request\(\s*"network\.share\.add"/);
  assert.match(shares, /request\(\s*"network\.share\.mount"/);
  assert.match(shares, /nudgeOriginWriteReseed/);
  assert.ok(
    !/pageLifetimePromptTransport|pagePromptTransport/.test(shares),
    "add/mount must not move onto the seat socket"
  );
  assert.match(hook, /mergePromptLists\(writePrompts, list\.prompts\)/);
  assert.match(hook, /promptAnswerOnWrite/);
  assert.match(hook, /list_user_interactions/);
  const sources = src("features/sources/SourcesSurface.tsx");
  assert.ok(!/PasswordField/.test(sources), "file-sharing PasswordField stays held");
});
