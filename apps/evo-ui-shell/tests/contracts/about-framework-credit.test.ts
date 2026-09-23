// Contract: Settings -> About says where the framework lives. After the
// version, status, updated time and live-updates lines it shows the
// framework credit, a QR code to the concept site (a link off the kiosk,
// the same rule the provider credits use), and one row for each public
// repository. The provider licence rows stay.
// Run:
//   node --experimental-strip-types --test tests/contracts/about-framework-credit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FRAMEWORK_NAME,
  FRAMEWORK_SITE,
  PUBLIC_REPOSITORIES,
  PUBLIC_REPOSITORY_HOME
} from "../../src/features/system/framework-credits.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const credits = readFileSync(join(root, "features", "system", "CreditsPanel.tsx"), "utf8");
const surface = readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

test("the framework credit names the framework and the concept site", () => {
  assert.equal(FRAMEWORK_NAME, "Evo Framework");
  assert.equal(FRAMEWORK_SITE, "https://evoframework.org");
});

test("every public repository has a row, at its public home, and nothing internal", () => {
  const names = PUBLIC_REPOSITORIES.map((r) => r.name);
  assert.deepEqual(names, [
    "evo-core",
    "evo-ui",
    "evo-device-audio",
    "evo-device-audio-ui",
    "evo-kiosk",
    "evo-catalogue-schemas"
  ]);
  assert.equal(PUBLIC_REPOSITORY_HOME, "https://github.com/foonerd/");
  for (const r of PUBLIC_REPOSITORIES) {
    assert.equal(r.url, PUBLIC_REPOSITORY_HOME + r.name);
    assert.ok(!/-eng\b/.test(r.name) && !/-eng\b/.test(r.url), r.name + " is a public name");
    assert.ok(r.provides.trim().length > 0, r.name + " says what it is");
  }
});

test("About renders the credit, the concept-site QR, and the repository rows through the credits panel", () => {
  assert.ok(/<CreditsPanel \/>/.test(surface), "About still mounts the credits panel");
  assert.ok(/FRAMEWORK_SITE/.test(credits), "the concept site is rendered");
  assert.ok(/PUBLIC_REPOSITORIES/.test(credits), "the repository rows are rendered");
  // The same kiosk rule as the provider rows: QR by default, a link off-kiosk.
  assert.ok(/<QrCode url=\{FRAMEWORK_SITE\}/.test(credits), "the concept site is a QR on the kiosk");
  assert.ok(/href=\{FRAMEWORK_SITE\}/.test(credits), "the concept site is a link off the kiosk");
  assert.ok(/<QrCode url=\{r\.url\}/.test(credits), "each repository is a QR on the kiosk");
  assert.ok(/href=\{r\.url\}/.test(credits), "each repository is a link off the kiosk");
  // The provider licence rows stay.
  assert.ok(/CREDITS/.test(credits) && /MusicBrainz/.test(credits), "provider credits stay");
  assert.ok(!/-eng/.test(credits), "no eng name on the glass");
});

test("the credit sentences exist and are plain ASCII", () => {
  for (const key of [
    "settings.about.framework.title",
    "settings.about.framework.body",
    "settings.about.repos.title",
    "settings.about.repos.body"
  ]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '": "([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});
