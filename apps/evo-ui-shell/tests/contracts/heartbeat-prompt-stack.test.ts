// Contract: a Sources add that waits on a password must not hide
// that card under "Finishing the share". The working heartbeat
// stacks in the dialog attention band; the framework prompt band
// is above it. While a prompt is listed, Sources does not paint
// the heartbeat at all. Goes RED if HeartbeatPanel invents a
// z-index above the prompt band, or if Sources paints the scrim
// over a listed card.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(join(here, "..", "..", "src", rel), "utf8");
const css = src("styles.css");

test("PIN: HeartbeatPanel stacks in the dialog band; it does not invent z-index 200", () => {
  const panel = src("app/components/HeartbeatPanel.tsx");
  assert.match(panel, /AttentionOverlay/);
  assert.match(panel, /band="dialog"/);
  assert.match(panel, /modal=\{false\}/);
  const root = css.match(/\.evo-heartbeat-panel-root \{([^}]*)\}/);
  assert.ok(root !== null, "heartbeat root rule present");
  assert.ok(
    !/z-index:/.test(root[1] ?? ""),
    "z-index is the dialog attention band, not a private overlay"
  );
  assert.match(css, /--z-attn-dialog: 60;/);
  assert.match(css, /--z-attn-prompt: 68;/);
});

test("PIN: Sources does not paint the working scrim over a listed password card", () => {
  const surface = src("features/sources/SourcesSurface.tsx");
  assert.match(surface, /usePromptListed/);
  assert.match(surface, /beat !== null && !promptListed/);
  assert.ok(!/PasswordField/.test(surface));
});
