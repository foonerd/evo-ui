// Contract: the Settings group badges tell the truth. Network is available
// (the runtime stamps network.settings supported when the network plugin
// is present, and the glass maps supported to available). Multi-room is
// partial: it is not finished. Metadata is available: it is finished.
// Library, Cast, Sources and Smart home stay coming; File sharing,
// Security and Activity stay available; Audio and System stay partial.
// Run:
//   node --experimental-strip-types --test tests/contracts/settings-badges.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const shellSrc = join(here, "..", "..", "src");
const surface = readFileSync(join(shellSrc, "features", "system", "SystemSurface.tsx"), "utf8");
const catalogue = readFileSync(
  join(here, "..", "..", "..", "evo-ui-runtime", "src", "catalogue.rs"),
  "utf8"
);

// The availability map is one object literal; read each badge from it.
function badge(group: string): string | null {
  const m = surface.match(new RegExp('^\\s*"?' + group + '"?:\\s*("[a-z-]+"|[^,\\n]+),?$', "m"));
  return m === null ? null : m[1].trim();
}

test("the runtime stamps network settings as supported when the network plugin is present", () => {
  assert.ok(
    /\("networking\.link",\s*"network\.settings",\s*"supported"\)/.test(catalogue),
    "network.settings must be stamped supported, not partial"
  );
  assert.ok(
    !/\("networking\.link",\s*"network\.settings",\s*"partial"\)/.test(catalogue),
    "no partial stamp for network.settings remains"
  );
  assert.ok(
    /assert!\(caps\.contains\(&\("network\.settings",\s*"supported"\)\)\)/.test(catalogue),
    "the runtime test expects supported"
  );
});

test("Network is available when the runtime says supported, and never hard-coded partial", () => {
  const network = badge("network");
  assert.ok(network !== null, "the network badge is in the availability map");
  assert.ok(/networkStatus === "supported" \? "available"/.test(network), "supported maps to available");
  assert.notEqual(network, '"partial"', "Network is not a hard-coded partial");
});

test("Multi-room is partial: it is not finished", () => {
  assert.equal(badge("multi-room"), '"partial"');
});

test("Metadata is available: it is finished, and no old comment keeps it down", () => {
  assert.equal(badge("metadata"), '"available"');
  assert.ok(!/scrobbling \+ anonymisation controls/.test(surface), "the old scrobbling comment is gone");
});

test("the promises stay coming, the finished groups stay available, the half-built stay partial", () => {
  for (const g of ["library", "cast", "sources", "smart-home"]) {
    assert.equal(badge(g), '"coming"', g + " stays coming");
  }
  for (const g of ["file-sharing", "security", "activity", "about"]) {
    assert.equal(badge(g), '"available"', g + " stays available");
  }
  assert.equal(badge("system"), '"partial"');
  assert.ok(/audio: canUseSettings \? "partial" : "coming"/.test(surface), "audio stays partial when settings are served");
});
