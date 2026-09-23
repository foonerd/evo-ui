// Contract: the glass that submitted Add share paints, answers and
// cancels the password card without claiming user_interaction_responder.
//
// The framework admits the origin door on list_user_interactions and on
// answer / cancel: a connection with no seat sees and settles the prompts
// its own dispatches raised; with none of its own open it is refused
// user_interaction_responder_not_granted exactly as before. So the hook
// lists on every open, seat or not, keeps the first-claimer loop as it
// was, and treats that one refusal - for a session without the seat - as
// silence: no card, no failed-list record. The surface paints a listed
// prompt whether or not the seat is held; the failed-list notice stays
// the seat holder's. LAN-trust still never opens this socket.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  originListSilence,
  RESPONDER_NOT_GRANTED
} from "../../src/features/prompts/origin-list.ts";
import { applyPromptList } from "../../src/features/prompts/prompt-list-outcome.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const hook = src("features/prompts/usePromptResponder.ts");
const surface = src("features/prompts/PromptSurface.tsx");
const pure = src("features/prompts/origin-list.ts");

const between = (s: string, from: string, to: string): string => {
  const a = s.indexOf(from);
  const b = s.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `expected "${from}" .. "${to}"`);
  return s.slice(a, b);
};

// ---- the pure rule ------------------------------------------------------

test("without the seat, a not-granted refusal is silence; anything else is not", () => {
  const notGranted = { error: { code: "permission_denied", message: "not granted", subclass: RESPONDER_NOT_GRANTED } };
  assert.equal(originListSilence(notGranted, false), true);
  assert.equal(originListSilence(notGranted, true), false, "the seat holder keeps the failure semantics");
  assert.equal(originListSilence({ error: { code: "connection_closed" } }, false), false, "a dropped socket is a failure, not silence");
  assert.equal(originListSilence({ error: { code: "permission_denied", subclass: "responder_slot_held_by_other" } }, false), false);
  assert.equal(originListSilence({ value: { prompts: [] } }, false), false, "a landed list is applied, not silenced");
  assert.equal(RESPONDER_NOT_GRANTED, "user_interaction_responder_not_granted");
  assert.ok(!/from "preact|WsTransport|pluginRequest|i18n/.test(pure), "pure");
});

test("the silence is not a failed list and not a landed empty list: applyPromptList is untouched beside it", () => {
  // The same refusal through the unchanged outcome module still keeps
  // landed prompts and records the failure - that is the seat holder's
  // path, and it has not moved.
  const landed = [{ plugin: "p", promptId: "x" }] as unknown as Parameters<typeof applyPromptList>[0];
  const out = applyPromptList(
    landed,
    { error: { code: "permission_denied", message: "not granted" } },
    () => null,
    () => "unreadable"
  );
  assert.equal(out.prompts.length, 1);
  assert.equal(out.listError, "not granted");
});

// ---- the hook: list on every open, seat or not -------------------------

test("the hook lists at once on every open, beside the claim, never behind it", () => {
  const open = between(hook, 'if (socketState === "open") {', "} else {");
  assert.match(open, /void reseed\(\);\s*void claim\(\);/, "reopen: origin list first, then the seat claim");
  const first = between(hook, "void reseed();\n      await claim();", "void run();");
  assert.ok(first.length >= 0, "first open: origin list, then the seat claim");
  assert.equal((hook.match(/void reseed\(\);\s*(?:await|void) claim\(\);/g) ?? []).length, 2, "both opens");
  const reseed = between(hook, "const reseed = async (): Promise<void> => {", "reseedRef.current = reseed;");
  assert.match(reseed, /if \(originListSilence\(result, seatHeld\)\) \{\s*setList\(\{ prompts: \[\], listError: null \}\);\s*return;\s*\}/, "silence paints nothing and records nothing");
  assert.match(reseed, /setList\(\(prev\) =>\s*applyPromptList\(prev\.prompts, result,/, "everything else folds through the unchanged outcome");
  assert.ok(!/negotiate/.test(reseed), "the list never claims");
});

test("the seat claim loop is as it was: negotiate until granted, first claimer wins, release on unmount", () => {
  const claim = between(hook, "const claim = async (): Promise<void> => {", "// A bearer socket that will not (re)open");
  assert.match(claim, /let granted = await negotiateOnce\(\);\s*while \(!granted && !stale\(\)\) \{/);
  assert.match(claim, /setTimeout\(r, 5000\)/);
  assert.match(claim, /seatHeld = true;\s*setStatus\("active"\);\s*setResponderGranted\(true\);\s*await reseed\(\);/, "granted: the seat lists everything");
  assert.match(claim, /seatHeld = false;\s*setStatus\("inactive"\);/, "not granted: inactive, the origin list stands");
  assert.equal((hook.match(/dispatch\("negotiate"/g) ?? []).length, 2, "the claim negotiate and the probe, no third");
  assert.match(hook, /if \(!shouldClaimResponder\(storedBearer\(\)\)\) \{\s*setStatus\("inactive"\);\s*setResponderGranted\(false\);\s*return undefined;/, "LAN-trust never opens this socket");
  assert.match(hook, /bearerSource: storedBearer,/, "the bearer is read at every handshake");
  assert.match(hook, /dispatch\("release_user_interaction_responder", \{\}\)/, "release on unmount");
  assert.match(hook, /\} else \{\s*claimGen \+= 1;\s*seatHeld = false;\s*setStatus\("inactive"\);/, "a drop clears the seat");
  assert.match(hook, /onBearerChange\(reauthPromptResponder\)/);
  assert.match(hook, /isPromptShelfChange\(raw\)\) void reseed\(\);/, "prompts.active re-lists, seat or not");
});

// ---- the surface: a listed prompt paints without the seat --------------

test("PromptSurface paints a listed prompt whether or not this session holds the seat", () => {
  const body = between(surface, "const responder = usePromptResponder();", "const current = responder.prompts[0];");
  assert.match(body, /^\s*if \(responder\.prompts\.length === 0\) \{/m, "the only gate on painting a card is a listed prompt");
  assert.ok(!/if \(responder\.status !== "active"\) \{\s*return null;/.test(surface), "no seat-only return ahead of the card");
  assert.match(body, /if \(responder\.status !== "active" \|\| responder\.listError === null\) return null;/, "failed-list notice: seat holder only; origin silence stays quiet");
  assert.match(surface, /<PromptCard\s+key=\{`\$\{current\.plugin\}#\$\{current\.promptId\}`\}/);
  assert.equal((surface.match(/<PromptCard/g) ?? []).length, 1, "one card");
  assert.ok(!/Escape|onKeyDown|dismissible/.test(surface), "no ESC, no backdrop dismiss");
  assert.match(surface, /type=\{kind\.kind === "password" && !reveal \? "password" : "text"\}/, "the password is not echoed");
  assert.match(surface, /onClick=\{\(\) => void run\(\(\) => onCancel\(item\)\)\}/, "Cancel is a wire answer");
  assert.match(surface, /t\("prompt\.listFailed"\)/);
});

// ---- the Sources form: the held pin, not this row ------------------------
// The origin paint above is the prompt surface's. The Sources start
// gate is a separately held pin (sources-add-gate.test.ts): valid
// form only, password on the same Add dialog. This row does not
// decide it.

test("the Sources start gate is the held valid-form pin; password is on this dialog", () => {
  const sources = src("features/sources/SourcesSurface.tsx");
  assert.match(sources, /canStartShareAdd\(\{ valid, credKind \}\)/);
  assert.match(sources, /reveal \? "text" : "password"/);
  assert.match(sources, /password-reveal-button/);
  assert.ok(!/from ["'].*PasswordField["']/.test(sources));
});
