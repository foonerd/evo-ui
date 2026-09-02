import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoopbackHost,
  scopeFromPath,
  sessionScope,
} from "../../src/runtime/session-scope.ts";

import {
  parseTargetKey,
  targetKeyFor,
} from "../../src/runtime/presentation-target.ts";

test("kiosk on loopback is native - the default requires no typing", () => {
  assert.equal(sessionScope("/", "localhost"), "native");
  assert.equal(sessionScope("/", "127.0.0.1"), "native");
  assert.equal(sessionScope("/", "127.8.4.2"), "native");
  assert.equal(sessionScope("/", "::1"), "native");
  assert.equal(sessionScope("/", "[::1]"), "native");
});

test("browsers by device IP or name are remote", () => {
  assert.equal(sessionScope("/", "192.0.2.24"), "remote");
  assert.equal(sessionScope("/", "device.local"), "remote");
  assert.equal(sessionScope("/", "evoframework.org"), "remote");
});

test("explicit path wins over hostname - both directions", () => {
  // The remote-testing case: /native from a desk.
  assert.equal(sessionScope("/native", "192.0.2.24"), "native");
  assert.equal(sessionScope("/native/", "192.0.2.24"), "native");
  // The reference view on the panel glass.
  assert.equal(sessionScope("/remote", "localhost"), "remote");
  assert.equal(sessionScope("/remote/", "127.0.0.1"), "remote");
});

test("only the first path segment is an entry point", () => {
  assert.equal(scopeFromPath("/native"), "native");
  assert.equal(scopeFromPath("/remote"), "remote");
  assert.equal(scopeFromPath("/"), null);
  assert.equal(scopeFromPath(""), null);
  assert.equal(scopeFromPath("/settings/native"), null);
  assert.equal(scopeFromPath("/nativeish"), null);
});

test("declared native identity round-trips through the target key", () => {
  // encode -> decode is lossless (portrait normalises to long x short)
  assert.deepEqual(parseTargetKey(targetKeyFor(800, 480, 5)!), {
    widthPx: 800,
    heightPx: 480,
    diagonalInches: 5,
  });
  assert.deepEqual(parseTargetKey(targetKeyFor(480, 800, 5)!), {
    widthPx: 800,
    heightPx: 480,
    diagonalInches: 5,
  });
  assert.deepEqual(parseTargetKey("1280x800@10.1"), {
    widthPx: 1280,
    heightPx: 800,
    diagonalInches: 10.1,
  });
  // Garbage never becomes glass.
  assert.equal(parseTargetKey(""), null);
  assert.equal(parseTargetKey("800x480"), null);
  assert.equal(parseTargetKey("800x480@0"), null);
  assert.equal(parseTargetKey("panel@5"), null);
});

test("loopback detection is not fooled by lookalikes", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("localhost.example.com"), false);
  assert.equal(isLoopbackHost("127.0.0.1.evil.com"), false);
  assert.equal(isLoopbackHost("1127.0.0.1"), false);
  assert.equal(isLoopbackHost("10.0.0.1"), false);
});
