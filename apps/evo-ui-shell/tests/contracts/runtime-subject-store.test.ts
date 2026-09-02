import test from "node:test";
import assert from "node:assert/strict";
import { SubjectStore, decodeHappening } from "../../src/runtime/subjects.ts";

test("SubjectStore.applyStateChanged inserts a new row", () => {
  const store = new SubjectStore();
  store.applyStateChanged(
    1,
    "library:track:42",
    "audio.track",
    "org.example.audio",
    { title: "Hello" },
    1000,
  );
  const subject = store.byId.value["library:track:42"];
  assert.ok(subject !== undefined);
  assert.equal(subject.subjectType, "audio.track");
  assert.deepEqual(subject.state, { title: "Hello" });
  assert.equal(subject.lastSeq, 1);
  assert.equal(store.cursor.value, 1);
});

test("SubjectStore.applyStateChanged with higher seq overwrites", () => {
  const store = new SubjectStore();
  store.applyStateChanged(1, "id", "t", "p", { v: 1 }, 1000);
  store.applyStateChanged(2, "id", "t", "p", { v: 2 }, 2000);
  assert.deepEqual(store.byId.value["id"].state, { v: 2 });
  assert.equal(store.byId.value["id"].lastSeq, 2);
  assert.equal(store.cursor.value, 2);
});

test("SubjectStore.applyStateChanged refuses earlier or equal seq", () => {
  const store = new SubjectStore();
  store.applyStateChanged(5, "id", "t", "p", { v: 5 }, 5000);
  store.applyStateChanged(3, "id", "t", "p", { v: 3 }, 3000);
  store.applyStateChanged(5, "id", "t", "p", { v: 5 }, 5000);
  assert.deepEqual(store.byId.value["id"].state, { v: 5 });
  assert.equal(store.byId.value["id"].lastSeq, 5);
  assert.equal(store.cursor.value, 5);
});

test("SubjectStore.applyForget removes the row but advances the cursor", () => {
  const store = new SubjectStore();
  store.applyStateChanged(1, "id", "t", "p", { v: 1 }, 1000);
  store.applyForget(2, "id");
  assert.equal(store.byId.value["id"], undefined);
  assert.equal(store.cursor.value, 2);
});

test("SubjectStore.byType filters by subject type", () => {
  const store = new SubjectStore();
  store.applyStateChanged(1, "a", "audio.track", "p", { v: "a" }, 1);
  store.applyStateChanged(2, "b", "audio.track", "p", { v: "b" }, 2);
  store.applyStateChanged(3, "c", "settings.theme", "p", { v: "c" }, 3);
  const tracks = store.byType("audio.track");
  assert.equal(tracks.length, 2);
  assert.ok(tracks.find((s) => s.id === "a") !== undefined);
  assert.ok(tracks.find((s) => s.id === "b") !== undefined);
});

test("decodeHappening returns null for non-object payloads", () => {
  assert.equal(decodeHappening(1, null), null);
  assert.equal(decodeHappening(1, 42), null);
  assert.equal(decodeHappening(1, "string"), null);
  assert.equal(decodeHappening(1, []), null);
});

test("decodeHappening surfaces unknown variants as `other`", () => {
  const decoded = decodeHappening(7, { kind: "totally_new_variant" });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "other");
  assert.equal(decoded.seq, 7);
  if (decoded.kind === "other") {
    assert.equal(decoded.variant, "totally_new_variant");
  }
});

test("decodeHappening decodes SubjectStateChanged", () => {
  const decoded = decodeHappening(10, {
    kind: "subject_state_changed",
    canonical_id: "id",
    subject_type: "audio.track",
    plugin: "p",
    new_state: { title: "x" },
    at_ms: 5000,
  });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "subject_state_changed");
  if (decoded.kind === "subject_state_changed") {
    assert.equal(decoded.canonicalId, "id");
    assert.equal(decoded.subjectType, "audio.track");
    assert.equal(decoded.owningPlugin, "p");
    assert.deepEqual(decoded.state, { title: "x" });
    assert.equal(decoded.atMs, 5000);
  }
});

test("decodeHappening decodes SubjectForgotten with reason", () => {
  const decoded = decodeHappening(11, {
    kind: "subject_forgotten",
    canonical_id: "id",
    reason: "subject_cascade",
  });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "subject_forgotten");
  if (decoded.kind === "subject_forgotten") {
    assert.equal(decoded.canonicalId, "id");
    assert.equal(decoded.reason, "subject_cascade");
  }
});

test("decodeHappening decodes SubjectMerged", () => {
  const decoded = decodeHappening(12, {
    kind: "subject_merged",
    retired_canonical_ids: ["a", "b"],
    new_canonical_id: "c",
  });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "subject_merged");
  if (decoded.kind === "subject_merged") {
    assert.deepEqual(decoded.retiredIds, ["a", "b"]);
    assert.equal(decoded.newId, "c");
  }
});

test("decodeHappening decodes SubjectSplit", () => {
  const decoded = decodeHappening(13, {
    kind: "subject_split",
    retired_canonical_id: "a",
    new_canonical_ids: ["b", "c"],
  });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "subject_split");
  if (decoded.kind === "subject_split") {
    assert.equal(decoded.retiredId, "a");
    assert.deepEqual(decoded.newIds, ["b", "c"]);
  }
});

test("decodeHappening decodes UiShelfChanged", () => {
  const decoded = decodeHappening(14, {
    kind: "ui_shelf_changed",
    shelf_id: "prompts.active",
    stockings: [],
  });
  assert.ok(decoded !== null);
  assert.equal(decoded.kind, "ui_shelf_changed");
  if (decoded.kind === "ui_shelf_changed") {
    assert.equal(decoded.shelfId, "prompts.active");
  }
});
