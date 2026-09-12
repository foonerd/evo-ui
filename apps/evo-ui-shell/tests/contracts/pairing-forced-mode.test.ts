// Contract: the onboarding pair (browser, no bearer) is a FORCED step - no
// Cancel, no ESC / backdrop / close. The Settings / surface pair (today's
// default) stays cancellable and still reloads when onPaired is absent.
//
// One flow, two modes on the EXISTING PairDeviceFlow + the shared Modal
// primitive - no second pair component and no dead no-op Cancel. Structural
// on purpose: the suite has no DOM renderer, so we assert the markup gates
// the dismiss controls on the mode.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) =>
  readFileSync(join(here, "..", "..", ...p), "utf8");
const pair = read("src", "features", "pairing", "PairDeviceFlow.tsx");
const dialogs = read("src", "components", "dialogs.tsx");

test("PairDeviceFlow takes a forced mode that drives the Modal non-dismissibly", () => {
  assert.ok(/\bforced\b/.test(pair), "PairDeviceFlow must accept a forced flag");
  assert.ok(
    /dismissible=\{!forced\}/.test(pair),
    "forced must make the Modal non-dismissible (kills ESC / backdrop / X)"
  );
});

test("forced onboarding pair renders no Cancel button (gated behind forced)", () => {
  assert.ok(
    /forced \? null :/.test(pair),
    "the Cancel action must be omitted when forced - not a dead no-op"
  );
});

test("default (Settings/surface) pair stays cancellable and still reloads", () => {
  assert.ok(/t\("dialog\.cancel"\)/.test(pair), "default mode keeps a Cancel");
  assert.ok(
    /window\.location\.reload\(\)/.test(pair),
    "default mode (no onPaired) still reloads so every transport re-handshakes"
  );
});

test("the shared Modal supports a non-dismissible mode", () => {
  assert.ok(/\bdismissible\b/.test(dialogs), "Modal must accept dismissible");
  assert.ok(
    /onDismiss=\{dismissible \? onCancel : undefined\}/.test(dialogs),
    "ESC dismiss must be gated on dismissible"
  );
  assert.ok(
    /dismissOnBackdrop=\{dismissible\}/.test(dialogs),
    "backdrop dismiss must be gated on dismissible"
  );
  assert.ok(
    /dismissible[\s\S]{0,80}evo-modal-close/.test(dialogs),
    "the X close button must be gated on dismissible"
  );
});
