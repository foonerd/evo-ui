// Contract test for the self-updating client's bundle-id extraction -
// the pure core of "has the served bundle changed under us?".

import test from "node:test";
import assert from "node:assert/strict";
import { parseBundleId } from "../../src/runtime/bundle-updater.ts";

test("extracts the hashed bundle id from an index.html body", () => {
  const html =
    '<!doctype html><html><head>' +
    '<script type="module" crossorigin src="/assets/index-ClQ-fl05.js"></script>' +
    '<link rel="stylesheet" href="/assets/index-B6IvTzBs.css">' +
    "</head><body><div id=app></div></body></html>";
  assert.equal(parseBundleId(html), "index-ClQ-fl05.js");
});

test("extracts from an absolute script src (loaded document form)", () => {
  assert.equal(
    parseBundleId("http://host.local/assets/index-BOQl0_F5.js"),
    "index-BOQl0_F5.js"
  );
});

test("matches hashes with hyphens and underscores", () => {
  assert.equal(parseBundleId("/assets/index-a_b-C9.js"), "index-a_b-C9.js");
});

test("returns null when no bundle reference is present", () => {
  assert.equal(parseBundleId("<html><body>nothing here</body></html>"), null);
  assert.equal(parseBundleId(""), null);
});

test("a changed served bundle is detectably different from the loaded one", () => {
  const loaded = parseBundleId("/assets/index-AAAA1111.js");
  const served = parseBundleId(
    '<script src="/assets/index-BBBB2222.js"></script>'
  );
  assert.ok(loaded !== null && served !== null);
  assert.notEqual(loaded, served); // triggers a reload
});
