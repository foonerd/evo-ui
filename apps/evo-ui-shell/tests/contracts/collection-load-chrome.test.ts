// Contract tests for the collection-load-chrome decision module.
// Pure, deterministic, and STATE-DRIVEN - no clocks. The affordance
// is decided by rule from current state, never by ad-hoc surface code
// and never by a stopwatch.

import test from "node:test";
import assert from "node:assert/strict";
import {
  collectionChromeMode,
  readCollectionLoadFlag,
  DEFAULT_COLLECTION_LOAD_FLAG,
  type CollectionLoadInputs
} from "../../src/runtime/collection-load-chrome.ts";

function inputs(over: Partial<CollectionLoadInputs>): CollectionLoadInputs {
  return {
    flag: "inline",
    loading: true,
    hasSnapshot: false,
    errored: false,
    probing: false,
    ...over
  };
}

test("flag off = hidden, no matter the state", () => {
  assert.equal(collectionChromeMode(inputs({ flag: "off" })), "hidden");
  assert.equal(
    collectionChromeMode(inputs({ flag: "off", probing: true })),
    "hidden"
  );
});

test("not loading = hidden", () => {
  assert.equal(collectionChromeMode(inputs({ loading: false })), "hidden");
});

test("hard error = hidden (surface owns the error UI)", () => {
  assert.equal(
    collectionChromeMode(inputs({ errored: true, probing: true })),
    "hidden"
  );
});

test("loading + empty = inline", () => {
  assert.equal(collectionChromeMode(inputs({})), "inline");
});

test("loading + snapshot present = inline (quiet), never a panel", () => {
  assert.equal(
    collectionChromeMode(
      inputs({ flag: "heartbeat", hasSnapshot: true, probing: true })
    ),
    "inline"
  );
});

test("inline flag never escalates to the panel, even when probing", () => {
  assert.equal(
    collectionChromeMode(inputs({ flag: "inline", probing: true })),
    "inline"
  );
});

test("heartbeat panel is driven by real probing state, not a clock", () => {
  // empty + heartbeat flag but NOT probing -> inline (no stopwatch)
  assert.equal(
    collectionChromeMode(inputs({ flag: "heartbeat", probing: false })),
    "inline"
  );
  // empty + heartbeat flag + source genuinely probing -> panel
  assert.equal(
    collectionChromeMode(inputs({ flag: "heartbeat", probing: true })),
    "heartbeat"
  );
});

// --- flag reader ---------------------------------------------------

test("readCollectionLoadFlag returns the default without a window", () => {
  const saved = (globalThis as { window?: unknown }).window;
  delete (globalThis as { window?: unknown }).window;
  try {
    assert.equal(readCollectionLoadFlag(), DEFAULT_COLLECTION_LOAD_FLAG);
  } finally {
    if (saved !== undefined) (globalThis as { window?: unknown }).window = saved;
  }
});

test("readCollectionLoadFlag reads a valid value and rejects junk", () => {
  const saved = (globalThis as { window?: unknown }).window;
  let stored: string | null = "heartbeat";
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: () => stored,
      setItem: () => {}
    }
  };
  try {
    assert.equal(readCollectionLoadFlag(), "heartbeat");
    stored = "off";
    assert.equal(readCollectionLoadFlag(), "off");
    stored = "garbage";
    assert.equal(readCollectionLoadFlag(), DEFAULT_COLLECTION_LOAD_FLAG);
    stored = null;
    assert.equal(readCollectionLoadFlag(), DEFAULT_COLLECTION_LOAD_FLAG);
  } finally {
    if (saved !== undefined) (globalThis as { window?: unknown }).window = saved;
    else delete (globalThis as { window?: unknown }).window;
  }
});
