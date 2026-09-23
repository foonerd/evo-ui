// Contract: a failed prompt list is not an empty seat.
//
// Field failure: the seat holder's reseed() returned on a refused or
// unreadable list_user_interactions and recorded nothing. A holder that
// had already claimed the seat could paint an empty list - nothing on
// the glass - while a prompt was live on the player. Now a list that
// does not land keeps every prompt that already did and records why;
// the holder paints that with a retry that re-runs the same list on the
// same socket. The claim and the subscription are untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyPromptList, finishPrompt } from "../../src/features/prompts/prompt-list-outcome.ts";
import type { PromptItem } from "../../src/features/prompts/prompt-decoders.ts";

const landed: PromptItem[] = [
  {
    plugin: "org.evoframework.network.shares",
    promptId: "share.audio/password/1",
    promptType: { kind: "password", label: "Password for Audio" },
    errorContext: null
  } as unknown as PromptItem
];

const decodeOk = (): PromptItem[] => [];
const decodeMiss = (): PromptItem[] | null => null;
const unrecognised = () => "unreadable";

test("a failed list does not clear landed prompts", () => {
  const out = applyPromptList(
    landed,
    { error: { code: "connection_closed", message: "connection closed" } },
    decodeOk,
    unrecognised
  );
  assert.equal(out.prompts, landed, "the landed prompts are kept, same array");
  assert.equal(out.listError, "connection closed");
});

test("a list that cannot be read keeps landed prompts and records the miss", () => {
  const out = applyPromptList(landed, { value: { nope: true } }, decodeMiss, unrecognised);
  assert.equal(out.prompts, landed);
  assert.equal(out.listError, "unreadable");
});

test("a landed list replaces the prompts and clears the record", () => {
  const out = applyPromptList(
    landed,
    { value: { user_interactions: true, prompts: [] } },
    decodeOk,
    unrecognised
  );
  assert.deepEqual(out.prompts, []);
  assert.equal(out.listError, null);
});

test("an error with no message falls back to its code, never to an empty seat", () => {
  const out = applyPromptList(landed, { error: { code: "permission_denied" } }, decodeOk, unrecognised);
  assert.equal(out.listError, "permission_denied");
  assert.equal(out.prompts.length, 1);
});

// ---- the hook and the surface ------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/prompts/usePromptResponder.ts");
const surface = src("features/prompts/PromptSurface.tsx");

test("retry re-runs the same list on the same socket", () => {
  assert.ok(/reseedRef\.current = reseed;/.test(hook), "the reseed closure is kept for the retry");
  assert.ok(
    /const relist = useCallback\(\(\) => \{\s*const reseed = reseedRef\.current;\s*if \(reseed !== null\) void reseed\(\);/.test(hook),
    "relist runs that closure"
  );
  const relistBlock = hook.slice(hook.indexOf("const relist = useCallback"), hook.indexOf("return { status, prompts"));
  assert.ok(!/negotiate|subscribe\(|pageLifetimePromptTransport\(/.test(relistBlock), "no second negotiate, no second attach, no new socket");
  assert.ok(/listError, relist,/.test(hook), "listError and relist are exposed");
  assert.ok(
    /setList\(\(prev\) =>\s*applyPromptList\(prev\.prompts, result,/.test(hook),
    "reseed folds through the pure outcome over the previous state"
  );
});

test("after a failed reseed, answering the last landed prompt does not paint prompt.listFailed", () => {
  // A happening triggered a reseed that failed while one prompt was on
  // the glass: the prompt stays, the failure is recorded.
  const failed = applyPromptList(
    landed,
    { error: { code: "connection_closed", message: "connection closed" } },
    decodeOk,
    unrecognised
  );
  assert.equal(failed.prompts.length, 1);
  assert.equal(failed.listError, "connection closed");
  // The operator answers it. The list is now empty and the stale record
  // goes with it - the surface has nothing to say "may be waiting" about.
  const after = finishPrompt(failed, landed[0]);
  assert.deepEqual(after, { prompts: [], listError: null });
});

test("finishing one of two prompts keeps the record until the list is empty", () => {
  const two: PromptItem[] = [
    landed[0],
    { ...landed[0], promptId: "share.audio/password/2" } as PromptItem
  ];
  const failed = applyPromptList(two, { error: { code: "refused" } }, decodeOk, unrecognised);
  const one = finishPrompt(failed, two[0]);
  assert.equal(one.prompts.length, 1);
  assert.equal(one.listError, "refused", "a prompt is still on the glass; the record is not stale yet");
  const none = finishPrompt(one, two[1]);
  assert.deepEqual(none, { prompts: [], listError: null });
});

test("finishPrompt is functional: an unknown item changes nothing, a neighbour is never restored", () => {
  const state = { prompts: landed, listError: null };
  const same = finishPrompt(state, { plugin: "other", promptId: "x" });
  assert.deepEqual(same.prompts, landed);
  assert.ok(
    /setList\(\(prev\) => finishPrompt\(prev, item\)\)/.test(hook),
    "answer and cancel fold over the previous state, never a snapshot"
  );
  assert.equal((hook.match(/setList\(\(prev\) => finishPrompt\(prev, item\)\)/g) ?? []).length, 2);
  assert.ok(!/promptsRef/.test(hook), "no read-once-write-back mirror");
});

test("negotiate and the holder claim are untouched", () => {
  assert.ok(/capabilities: \[RESPONDER_CAPABILITY\]/.test(hook), "the claim asks for the seat");
  assert.ok(/const claim = async \(\): Promise<void> => \{[\s\S]*?let granted = await negotiateOnce\(\);/.test(hook));
  assert.ok(/if \(!shouldClaimResponder\(storedBearer\(\)\)\)/.test(hook), "no bearer, no claim");
  assert.ok(/socketState === "open"[\s\S]*?void claim\(\);/.test(hook), "reopen re-claims");
  const negotiates = hook.match(/dispatch\("negotiate"/g) ?? [];
  assert.equal(negotiates.length, 2, "the claim negotiate and the anonymous probe negotiate, no third");
});

test("the holder paints a failed list honestly, with the retry; the failed-list notice is the seat holder's alone", () => {
  assert.ok(
    /if \(responder\.prompts\.length === 0\) \{[\s\S]*?if \(responder\.status !== "active" \|\| responder\.listError === null\) return null;/.test(surface),
    "no prompts: only the seat holder with a recorded failure paints; in flight and the origin stay quiet"
  );
  assert.ok(!/if \(responder\.status !== "active"\) \{\s*return null;/.test(surface), "a listed prompt paints without the seat (the origin door)");
  assert.ok(/t\("prompt\.listFailed"\)/.test(surface));
  assert.ok(/onClick=\{responder\.relist\}/.test(surface));
  assert.ok(/modal=\{false\}/.test(surface), "the notice is not a second card");
  const en = src("locales/en.ts");
  for (const key of ["prompt.listFailed", "prompt.listRetry", "prompt.listUnreadable"]) {
    const m = new RegExp(`"${key.split(".").join("\\.")}":\\s*"([^"]*)"`).exec(en);
    assert.ok(m !== null && /^[\x20-\x7E]+$/.test(m![1]), `${key} exists, 7-bit`);
  }
});
