import test from "node:test";
import assert from "node:assert/strict";
import { canRunSearch, normalizeSearchQuery } from "../../src/core/search-query.ts";

test("normalizeSearchQuery trims leading and trailing whitespace", () => {
  assert.equal(normalizeSearchQuery("  evo  "), "evo");
});

test("canRunSearch returns false for blank/whitespace queries", () => {
  assert.equal(canRunSearch(""), false);
  assert.equal(canRunSearch("   "), false);
});

test("canRunSearch returns true for non-empty normalized query", () => {
  assert.equal(canRunSearch("  query "), true);
});
