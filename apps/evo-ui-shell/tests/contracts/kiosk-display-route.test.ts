// Contract: Display & Touch has ONE write path, and the glass takes it.
//
// The system.kiosk plugin verbs are the writer. On the binary glass and VM
// run (evo-kiosk-eng 75796d9) the WebKit touch slots are gone and
// evo_set_display_rotation is a presence probe, not a writer. The handlers
// USED to write: they reached the same evo-kiosk-config functions in-process,
// never touching the framework dispatcher, so nothing could refuse them - a
// box locked to "play only" could still rotate from its own screen. That
// ungated piece is still live on the OLD binary (the NUC and Latest testers,
// remint not named), so the panel must never reach for it.
//
// So the panel routes glass and remote through the same plugin write, and the
// same classifier decides what the operator sees. These assertions are
// structural on purpose: the failure this guards against is someone
// reintroducing `if (isRemote) ... else <webkit>`, which no value-level test
// of a pure helper would catch.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyKioskWrite } from "../../src/features/kiosk/osk-state.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kioskDir = join(here, "..", "..", "src", "features", "kiosk");
const panel = readFileSync(join(kioskDir, "KioskDisplayPanel.tsx"), "utf8");
const bridge = readFileSync(join(kioskDir, "kiosk-bridge.ts"), "utf8");
const wizard = readFileSync(
  join(kioskDir, "TouchCalibrationWizard.tsx"),
  "utf8"
);
const en = readFileSync(
  join(here, "..", "..", "src", "locales", "en.ts"),
  "utf8"
);

/** Source with comments stripped. Assertions about what the code DOES
 *  must not be satisfied - or tripped - by what a comment SAYS. */
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** Body of a `const <name> = (...) => { ... };` arrow, up to its closing
 *  `\n  };` at panel indentation. Comments above it are excluded. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = (`);
  assert.notEqual(start, -1, `${name} not found in the panel`);
  const end = src.indexOf("\n  };", start);
  assert.notEqual(end, -1, `${name} body not delimited`);
  return src.slice(start, end);
}

test("the panel imports no write helper from the WebKit bridge", () => {
  const importLine = /import\s*{([^}]*)}\s*from\s*"\.\/kiosk-bridge"/s.exec(panel);
  assert.notEqual(importLine, null, "panel must still import from kiosk-bridge");
  const named = importLine![1];
  assert.ok(
    !named.includes("setDisplayRotation"),
    "panel must not import the WebKit rotation writer"
  );
  assert.ok(
    !named.includes("setTouchCalibration"),
    "panel must not import the WebKit touch writer"
  );
});

test("pickOrientation dispatches the plugin verb, with no mode branch", () => {
  const body = bodyOf(panel, "pickOrientation");
  assert.ok(
    body.includes("remote.setDisplayRotation("),
    "orientation must go over the system.kiosk verb"
  );
  assert.ok(
    !body.includes("isRemote"),
    "orientation must not branch on glass vs remote"
  );
  assert.ok(
    body.includes("runRemote("),
    "orientation must commit only after the write succeeds"
  );
});

test("applyTouch dispatches the plugin verb, with no mode branch", () => {
  const body = bodyOf(panel, "applyTouch");
  assert.ok(
    body.includes("remote.setTouchCalibration("),
    "touch must go over the system.kiosk verb"
  );
  assert.ok(
    !body.includes("isRemote"),
    "touch must not branch on glass vs remote"
  );
  assert.ok(
    body.includes("runRemote("),
    "touch must commit only after the write succeeds"
  );
});

test("no Display/Touch control calls the WebKit writers directly", () => {
  // Bare `setDisplayRotation(` / `setTouchCalibration(` with no `remote.`
  // prefix would be the bridge call coming back.
  assert.ok(
    !/(?<!remote\.)\bsetDisplayRotation\(/.test(panel),
    "panel calls the WebKit rotation writer"
  );
  assert.ok(
    !/(?<!remote\.)\bsetTouchCalibration\(/.test(panel),
    "panel calls the WebKit touch writer"
  );
});

test("the bridge no longer offers a display-rotation writer at all", () => {
  assert.ok(
    !/export function setDisplayRotation/.test(bridge),
    "kiosk-bridge must not export a rotation writer for the UI to find"
  );
});

test("glass and remote reach the same classifier for the same refusal", () => {
  // There is no mode parameter, and that is the point: one route means one
  // verdict. A household lock is "locked" - the notice + door - and not the
  // "controls not in place" banner, whichever screen asked.
  const refusal = { ok: false, subclass: "household_policy_locked" };
  assert.equal(classifyKioskWrite(refusal), "locked");
  assert.equal(classifyKioskWrite({ ok: false }), "blocked");
  assert.equal(classifyKioskWrite({ ok: true }), "ok");
});

test("Display does not paint a household notice on the live panel", () => {
  // Entry is HouseholdSurfaceGate on the System group. A banner on this
  // panel after a click is the old lie.
  assert.ok(
    !/HouseholdLockedNotice/.test(panel),
    "the live Display panel must not mount HouseholdLockedNotice"
  );
});

test("the blocked banner is mode-neutral: no isRemote gate, old key gone", () => {
  // classifyKioskWrite === "blocked" must show on glass AND remote - the write
  // path is the plugin verb either way, so the banner has no mode gate.
  assert.ok(
    /blocked && !householdLocked \?/.test(panel),
    "the blocked banner must render on `blocked && !householdLocked`"
  );
  assert.ok(
    !/isRemote[^\n]*&&[^\n]*\bblocked\b/.test(panel),
    "the blocked banner must not be gated on isRemote"
  );
  assert.ok(
    !/kiosk\.remoteUnavailable/.test(panel),
    "the remote-only 'unavailable' copy must be gone from the panel"
  );
  assert.ok(
    /t\("kiosk\.displayRefused"\)/.test(panel),
    "the banner must use the mode-neutral displayRefused copy"
  );
});

test("glass Calibrate opens the wizard; the System gate is the lock", () => {
  // The panel sits behind HouseholdSurfaceGate on the System group. Once
  // that gate mounts children, unlocked means unlocked: Calibrate opens
  // the wizard. A systemProtected pre-check here is a second ask (it
  // still fires after a password override, because the level is unchanged).
  const body = bodyOf(panel, "onCalibrate");
  assert.ok(
    !/systemProtected/.test(body),
    "Calibrate must not re-ask household on the live panel"
  );
  assert.ok(
    !/isGroupProtected\(/.test(panel),
    "Display must not re-resolve the System lock; the entry gate already did"
  );
  assert.notEqual(
    body.indexOf("setWizardOpen(true)"),
    -1,
    "the glass branch opens the wizard"
  );
  assert.ok(
    !/PairDeviceFlow|setPairOpen/.test(body),
    "the calibrate path must not reach for a Pair flow"
  );
});

test("the display-refused copy is honest: player refused, not 'own screen'", () => {
  const m = /"kiosk\.displayRefused":\s*"([^"]*)"/.exec(en);
  assert.notEqual(m, null, "kiosk.displayRefused must exist");
  const copy = m![1].toLowerCase();
  assert.ok(!copy.includes("own screen"), "no 'own screen'");
  assert.ok(!copy.includes("other screen"), "no 'other screen'");
  assert.ok(
    !copy.includes("not in place"),
    "not the 'controls not in place' household stand-in"
  );
  assert.ok(copy.includes("refused"), "must say the player refused the change");
});

// ---------------------------------------------------------------------
// The wizard takes the same route.
//
// Its reset-to-identity (which wipes the touch matrix before sampling) and
// its derive (which computes and applies the new one) USED to be the last
// ungated writes in the UI - WebKit handlers that called evo_kiosk_config
// in-process. Both are on the system.kiosk verbs now, so both are gated
// system writes. The System household gate is the lock; once this panel
// is mounted the wizard opens, and a refused reset is classified (never
// Pair, never an ungated write).
// ---------------------------------------------------------------------

test("the wizard imports no write helper from the WebKit bridge", () => {
  const imports = [...wizard.matchAll(/from\s*"\.\/kiosk-bridge"/g)];
  assert.ok(imports.length <= 1, "at most one bridge import");
  for (const name of [
    "sampleTouchFromCorners",
    "setTouchCalibration",
    "setDisplayRotation"
  ]) {
    assert.ok(
      !new RegExp(`import[^;]*\\b${name}\\b[^;]*from\\s*"\\./kiosk-bridge"`, "s").test(
        wizard
      ),
      `wizard must not import ${name} from the bridge`
    );
  }
});

test("the wizard's reset goes over the gated verb", () => {
  assert.ok(
    /remote\.setTouchCalibration\("0",\s*false,\s*false/.test(wizard),
    "reset-to-identity must dispatch set_touch_calibration"
  );
  assert.ok(
    !/(?<!remote\.)\bsetTouchCalibration\(/.test(codeOf(wizard)),
    "wizard still calls the WebKit touch writer"
  );
});

test("the wizard's derive goes over the gated verb", () => {
  assert.ok(
    /\.deriveTouchCalibrationFromCorners\(/.test(codeOf(wizard)),
    "derive must dispatch derive_touch_calibration_from_corners"
  );
  assert.ok(
    !/\bsampleTouchFromCorners\(/.test(codeOf(wizard)),
    "wizard still calls the WebKit derive handler"
  );
});

test("the wizard classifies with the one classifier and opens the one door", () => {
  assert.ok(
    /classifyKioskWrite\(/.test(wizard),
    "the wizard must use the shared classifier"
  );
  assert.ok(
    /useHouseholdModal\(/.test(wizard),
    "a locked write must reach the household modal"
  );
  // Not Pair, not a second host. Checked against code only - the header
  // comment says the word "Pair" precisely to record that it is excluded.
  assert.ok(
    !/usePair|from\s*"[^"]*\bpair\b[^"]*"/i.test(codeOf(wizard)),
    "the wizard must not reach for Pair"
  );
});

test("the wizard's reset and derive settle on a deadline", () => {
  assert.ok(
    /settleKioskCalWrite\(/.test(wizard),
    "wizard writes must race the work against a deadline"
  );
  assert.ok(
    /KIOSK_CAL_WRITE_DEADLINE_MS/.test(wizard),
    "the deadline is the shared constant, not a one-off timer"
  );
  assert.ok(
    /signal:\s*ac\.signal/.test(wizard),
    "the transport must receive the abort so a parked request unparks"
  );
});

test("capture only starts after the reset is accepted", () => {
  // Sampling on a refused reset would derive a matrix from taps that are
  // still transformed - a wrong calibration written confidently.
  const resetEffect = wizard.slice(
    wizard.indexOf('if (phase !== "reset") return;'),
    wizard.indexOf('if (phase !== "submitting") return;')
  );
  assert.ok(resetEffect.length > 0, "reset effect not found");
  const capture = resetEffect.indexOf('setPhase("capture")');
  const ok = resetEffect.indexOf('case "ok":');
  assert.ok(ok !== -1, "reset must classify its write");
  assert.ok(
    capture > ok,
    "capture must be reached only from the ok branch"
  );
});

test("the bridge offers the UI no ungated write at all", () => {
  for (const name of [
    "setDisplayRotation",
    "setTouchCalibration",
    "sampleTouchFromCorners"
  ]) {
    assert.ok(
      !new RegExp(`export function ${name}`).test(bridge),
      `kiosk-bridge must not export ${name}`
    );
  }
  assert.ok(
    !/postMessage\(/.test(bridge),
    "kiosk-bridge must not post to any handler - it is a probe now"
  );
});
