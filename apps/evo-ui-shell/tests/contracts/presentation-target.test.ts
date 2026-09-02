import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPresentationPlan,
  deviceKindFromViewport,
  foldTierFor,
  interactionFor,
  is7kOverlay,
  ppiFor,
  resolveDeviceKind,
  resolveDisplayFactor,
  resolveSmallLanding,
  resolveTouchFloorMm,
  resolveTouchScale,
  resolveTypeScale,
  sizeClassFor,
  touchFloorPxFor,
  FALLBACK_TOUCH_FLOOR_PX
} from "../../src/runtime/presentation-target.ts";

// Canonical effective sizes — facts from DISPLAY_RESOLUTIONS.md / fold model.

test("foldTierFor matches RESPONSIVE_FOLD_MODEL decision tree", () => {
  assert.equal(foldTierFor(320, 240), "solo");
  assert.equal(foldTierFor(480, 272), "strip");
  assert.equal(foldTierFor(1480, 320), "bar");
  assert.equal(foldTierFor(640, 480), "stack");
  assert.equal(foldTierFor(800, 480), "split");
  assert.equal(foldTierFor(1280, 720), "full");
  assert.equal(foldTierFor(3840, 2160), "cinema");
});

test("sizeClassFor distinguishes wearable, small, standard", () => {
  assert.equal(sizeClassFor(480, 272), "wearable");
  assert.equal(sizeClassFor(640, 480), "small");
  assert.equal(sizeClassFor(800, 480), "standard");
  assert.equal(sizeClassFor(1920, 1080), "standard");
});

test("800x480 at 4in vs 8in shares fold tier but profile factor differs by target", () => {
  const viewport = { widthPx: 800, heightPx: 480 };
  const byTarget = {
    "800x480@4": { displayFactor: 1.15 },
    "800x480@8": { displayFactor: 1.0 }
  };
  const smallPanel = buildPresentationPlan({
    viewport,
    diagonalInches: 4,
    profileSettings: { byTarget }
  });
  const largePanel = buildPresentationPlan({
    viewport,
    diagonalInches: 8,
    profileSettings: { byTarget }
  });
  assert.equal(smallPanel.foldTier, "split");
  assert.equal(largePanel.foldTier, "split");
  assert.equal(smallPanel.displayFactor, 1.15);
  assert.equal(largePanel.displayFactor, 1.0);
});

test("interaction: compass only for compact panels; Stack-tier smalls go standard", () => {
  assert.equal(interactionFor("wearable", "panel", "solo"), "pivot");
  assert.equal(interactionFor("wearable", "panel", "strip"), "pivot");
  assert.equal(interactionFor("small", "panel", "solo"), "pivot");
  assert.equal(interactionFor("small", "panel", "strip"), "pivot");
  // A Stack-tier small (e.g. 480x800 portrait) is the standard column.
  assert.equal(interactionFor("small", "panel", "stack"), "standard");
  assert.equal(interactionFor("standard", "panel", "split"), "standard");
  assert.equal(interactionFor("standard", "panel", "full"), "standard");
  assert.equal(interactionFor("small", "mobile", "stack"), "standard");
  assert.equal(interactionFor("standard", "tablet", "full"), "standard");
});

test("deviceKindFromViewport recognises mobile and tablet reference sizes", () => {
  assert.equal(deviceKindFromViewport(390, 844), "mobile");
  assert.equal(deviceKindFromViewport(844, 390), "mobile");
  assert.equal(deviceKindFromViewport(768, 1024), "tablet");
  assert.equal(deviceKindFromViewport(800, 480), null);
});

test("resolveDeviceKind honours explicit setting over matrix hint", () => {
  const resolved = resolveDeviceKind({
    setting: "panel",
    matrixDeviceKind: "mobile",
    viewport: { widthPx: 390, heightPx: 844 }
  });
  assert.equal(resolved.resolved, "panel");
  assert.equal(resolved.source, "explicit");
});

test("resolveDeviceKind auto uses profile before matrix", () => {
  const fromProfile = resolveDeviceKind({
    setting: "auto",
    profileSettings: { custom: { deviceKind: "mobile" } },
    matrixDeviceKind: "panel",
    viewport: { widthPx: 800, heightPx: 480 }
  });
  assert.equal(fromProfile.resolved, "mobile");
  assert.equal(fromProfile.source, "profile");
});

test("resolveDeviceKind auto uses matrix hint then viewport then panel default", () => {
  assert.equal(
    resolveDeviceKind({
      setting: "auto",
      matrixDeviceKind: "mobile",
      viewport: { widthPx: 800, heightPx: 480 }
    }).resolved,
    "mobile"
  );
  assert.equal(
    resolveDeviceKind({
      setting: "auto",
      matrixDeviceKind: null,
      viewport: { widthPx: 390, heightPx: 844 }
    }).resolved,
    "mobile"
  );
  assert.equal(
    resolveDeviceKind({
      setting: "auto",
      matrixDeviceKind: null,
      viewport: { widthPx: 800, heightPx: 480 }
    }).resolved,
    "panel"
  );
});

test("buildPresentationPlan exposes resolved device kind on root plan", () => {
  const plan = buildPresentationPlan({
    viewport: { widthPx: 390, heightPx: 844 },
    deviceKindSetting: "auto",
    matrixDeviceKind: "mobile"
  });
  assert.equal(plan.deviceKind, "mobile");
  assert.equal(plan.interaction, "standard");
});

test("1280x720 kiosk band sets 7k overlay", () => {
  assert.equal(is7kOverlay(1280, 720), true);
  assert.equal(is7kOverlay(1920, 1080), false);
});

test("resolveDisplayFactor prefers preset over custom over default", () => {
  const settings = {
    byTarget: { "800x480@5": { displayFactor: 1.1 } },
    custom: { displayFactor: 0.9 }
  };
  assert.equal(resolveDisplayFactor("800x480@5", settings), 1.1);
  assert.equal(resolveDisplayFactor(null, settings), 0.9);
  assert.equal(resolveDisplayFactor(undefined, null), 1);
});

test("buildPresentationPlan uses pivot on 480x320 strip", () => {
  const plan = buildPresentationPlan({
    viewport: { widthPx: 480, heightPx: 320 }
  });
  assert.equal(plan.foldTier, "strip");
  assert.equal(plan.sizeClass, "wearable");
  assert.equal(plan.interaction, "pivot");
  assert.equal(plan.smallLanding, "compass");
  assert.equal(plan.displayMode, "player");
});

test("resolveSmallLanding prefers preset over custom over default", () => {
  const settings = {
    byTarget: { "480x320@4": { smallLanding: "track" as const } },
    custom: { smallLanding: "compass" as const }
  };
  assert.equal(resolveSmallLanding("480x320@4", settings), "track");
  assert.equal(resolveSmallLanding(null, settings), "compass");
  assert.equal(resolveSmallLanding(undefined, null), "compass");
});

test("buildPresentationPlan exposes profile smallLanding override", () => {
  const plan = buildPresentationPlan({
    viewport: { widthPx: 480, heightPx: 320 },
    profileSettings: { custom: { smallLanding: "track" } }
  });
  assert.equal(plan.smallLanding, "track");
});

test("ppiFor derives density and is null without a diagonal", () => {
  // 800x480 on 5in: sqrt(800^2+480^2)=933.1 / 5 = 186.6
  assert.equal(Math.round(ppiFor(800, 480, 5)!), 187);
  // 466x466 round watch on 1.8in is very dense
  assert.equal(Math.round(ppiFor(466, 466, 1.8)!), 366);
  assert.equal(ppiFor(800, 480, null), null);
  assert.equal(ppiFor(800, 480, 0), null);
});

test("touchFloorPxFor grows with PPI and falls back without a diagonal", () => {
  // 9mm at 187ppi ~ 66px; at 366ppi ~ 130px - same finger, denser screen, more px
  assert.equal(touchFloorPxFor(187, 9), 66);
  assert.equal(touchFloorPxFor(366, 9), 130);
  assert.equal(touchFloorPxFor(null, 9), FALLBACK_TOUCH_FLOOR_PX);
});

test("scale dials resolve preset over custom over default, touchScale floored at MIN_TOUCH_SCALE; sub-1 allowed", () => {
  const s = {
    byTarget: { "480x480@2.1": { touchFloorMm: 10, touchScale: 1.3, typeScale: 1.2 } },
    custom: { touchFloorMm: 8, touchScale: 0.3, typeScale: 0.9 }
  };
  assert.equal(resolveTouchFloorMm("480x480@2.1", s), 10);
  assert.equal(resolveTouchScale("480x480@2.1", s), 1.3);
  assert.equal(resolveTypeScale("480x480@2.1", s), 1.2);
  // custom path; touchScale below the 0.5 floor clamps to 0.5, but
  // values between 0.5 and 1 pass through - the operator may take
  // targets below the finger floor deliberately.
  assert.equal(resolveTouchFloorMm(null, s), 8);
  assert.equal(resolveTouchScale(null, s), 0.5);
  assert.equal(resolveTouchScale(null, { custom: { touchScale: 0.7 } }), 0.7);
  assert.equal(resolveTypeScale(null, s), 0.9);
  // defaults
  assert.equal(resolveTouchFloorMm(undefined, null), 9);
  assert.equal(resolveTouchScale(undefined, null), 1);
  assert.equal(resolveTypeScale(undefined, null), 1);
});

test("buildPresentationPlan derives physical touch floor and target from diagonal", () => {
  const watch = buildPresentationPlan({
    viewport: { widthPx: 466, heightPx: 466 },
    diagonalInches: 1.8,
    profileSettings: { custom: { touchScale: 1.2 } }
  });
  assert.equal(Math.round(watch.ppi!), 366);
  assert.equal(watch.touchFloorPx, 130);
  assert.equal(watch.touchTargetPx, Math.round(130 * 1.2));
  // unknown diagonal -> ppi null, px floor falls back
  const generic = buildPresentationPlan({ viewport: { widthPx: 800, heightPx: 480 } });
  assert.equal(generic.ppi, null);
  assert.equal(generic.touchFloorPx, FALLBACK_TOUCH_FLOOR_PX);
});
