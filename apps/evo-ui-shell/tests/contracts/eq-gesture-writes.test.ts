// Contract: an EQ gesture is one write. Dragging a band updates the curve
// locally and dispatches a single set_eq_band when the drag ends (pointer
// up or cancel), never one per movement or per debounce tick. The Q slider
// commits on release. Reset to flat goes through the atomic preset path
// (save the flat preset, recall it) and never through ten setters. The
// EQ-on flag is the next row's contract (eq-mode-from-settings.test.ts).
// Run:
//   node --experimental-strip-types --test tests/contracts/eq-gesture-writes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const panel = readFileSync(join(root, "features", "audio", "EqPanel.tsx"), "utf8");
const editor = readFileSync(join(root, "features", "audio", "EqCurveEditor.tsx"), "utf8");

test("a drag dispatches once, when it ends", () => {
  assert.ok(!/setTimeout\(/.test(panel), "no debounce timer dispatches a band");
  assert.ok(!/BAND_DISPATCH_DEBOUNCE/.test(panel), "the per-band debounce is gone");
  assert.ok(/onBandCommit/.test(editor), "the editor reports the end of a gesture");
  assert.ok(
    /const onPointerUp = \(\): void => \{[\s\S]*?onBandCommit\(/.test(editor),
    "pointer up commits the dragged band"
  );
  assert.ok(/onPointerCancel=\{onPointerUp\}/.test(editor), "pointer cancel ends the gesture the same way");
  assert.ok(
    !/const onPointerMove = \(ev: PointerEvent\): void => \{[\s\S]*?setBand\(/.test(editor),
    "pointer move never writes"
  );
  assert.ok(/onChange=\{\(\) => onBandCommit\(selectedIndex\)\}/.test(editor), "the Q slider commits on release");
  assert.ok(/onBandCommit=\{onBandCommit\}/.test(panel), "the panel wires the commit");
});

test("the panel commits only a band that changed, and only once per gesture", () => {
  assert.ok(/dirtyRef/.test(panel), "the panel tracks which bands a gesture changed");
  assert.ok(
    /const onBandCommit = useCallback\([\s\S]*?if \(!dirty\.has\(index\)\) return;[\s\S]*?dirty\.delete\(index\);[\s\S]*?void setBand\(index, /.test(panel),
    "commit dispatches set_eq_band once for a changed band and clears the mark"
  );
});

test("reset to flat is the atomic preset path, never ten setters", () => {
  assert.ok(/FLAT_PRESET_NAME/.test(panel), "the flat preset has one name");
  assert.ok(
    /const onReset = useCallback\([\s\S]*?await savePreset\(FLAT_PRESET_NAME, flat\)[\s\S]*?await recallPreset\(FLAT_PRESET_NAME\)/.test(panel),
    "reset saves the flat preset then recalls it"
  );
  assert.ok(
    !/const onReset = useCallback\([\s\S]*?for \(let i = 0; i < flat\.length; i\+\+\)/.test(panel),
    "reset has no per-band loop"
  );
});
