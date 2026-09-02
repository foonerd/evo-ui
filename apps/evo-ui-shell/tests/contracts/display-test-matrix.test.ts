import test from "node:test";
import assert from "node:assert/strict";
import {
  DISPLAY_TEST_MATRIX,
  viewportForMatrixEntry
} from "../../src/runtime/display-test-matrix.ts";

test("DISPLAY_TEST_MATRIX has 67 known resolutions", () => {
  assert.equal(DISPLAY_TEST_MATRIX.length, 67);
  const ids = new Set(DISPLAY_TEST_MATRIX.map((row) => row.id));
  assert.equal(ids.size, 67);
});

test("viewportForMatrixEntry swaps for portrait", () => {
  const split = DISPLAY_TEST_MATRIX.find((row) => row.id === "800x480");
  assert.ok(split);
  const landscape = viewportForMatrixEntry(split!, "landscape");
  const portrait = viewportForMatrixEntry(split!, "portrait");
  assert.equal(landscape.widthPx, 800);
  assert.equal(landscape.heightPx, 480);
  assert.equal(portrait.widthPx, 480);
  assert.equal(portrait.heightPx, 800);
});

test("square matrix entry ignores orientation swap", () => {
  const square = DISPLAY_TEST_MATRIX.find((row) => row.id === "720x720");
  assert.ok(square);
  assert.deepEqual(viewportForMatrixEntry(square!, "landscape"), {
    widthPx: 720,
    heightPx: 720
  });
  assert.deepEqual(viewportForMatrixEntry(square!, "portrait"), {
    widthPx: 720,
    heightPx: 720
  });
});

test("mobile and tablet matrix rows carry deviceKind tags", () => {
  const mobile = DISPLAY_TEST_MATRIX.filter((row) => row.deviceKind === "mobile");
  const tablet = DISPLAY_TEST_MATRIX.filter((row) => row.deviceKind === "tablet");
  assert.equal(mobile.length, 6);
  assert.equal(tablet.length, 1);
  assert.ok(mobile.some((row) => row.id === "390x844"));
  assert.ok(tablet.some((row) => row.id === "768x1024"));
});
