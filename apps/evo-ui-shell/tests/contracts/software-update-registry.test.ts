// Contract: Software update registers the audio update source. Opening the
// Software update view - and only that - checks the registries first
// (list_plugin_registries). A slug that begins evo-audio- means an audio
// registry is already there: it is the operator's channel and it is left
// alone. Otherwise the view registers evo-audio-prod through the existing
// step-up dispatch (plugins_admin.registerPluginRegistry ->
// register_plugin_registry); the card is the one step-up card, a cancel or
// a refusal stays on this view and registers nothing, and the glass does
// not send it again. The payload is the slug, the manifest and signature
// URLs for this device's target triple, and the pinned fingerprint. The
// triple comes from get_system_info.architecture; anything but aarch64,
// x86_64 or armv7l refuses on this view and registers nothing. Nothing
// registers on app boot, there is no channel picker, ComingSoon is off this
// view, and the dead update block on Operations is gone.
// Run:
//   node --experimental-strip-types --test tests/contracts/software-update-registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUDIO_PROD_FINGERPRINT,
  AUDIO_PROD_SLUG,
  AUDIO_REGISTRY_PREFIX,
  audioProdRegistration,
  audioRegistrySlugs,
  decodeRefreshed,
  decodeRegistered,
  decodeRegistrySlugs,
  refreshRegistryPayload,
  targetTriple
} from "../../src/features/update/software-update.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const helper = readFileSync(join(root, "features", "update", "software-update.ts"), "utf8");
const hook = readFileSync(join(root, "features", "update", "useSoftwareUpdate.ts"), "utf8");
const view = readFileSync(join(root, "features", "update", "SoftwareUpdateSurface.tsx"), "utf8");
const app = readFileSync(join(root, "app", "App.tsx"), "utf8");
const boot = readFileSync(join(root, "runtime", "boot.tsx"), "utf8");
const ops = readFileSync(join(root, "features", "operations", "OperationsSurface.tsx"), "utf8");
const opsState = readFileSync(join(root, "features", "operations", "useOperationsState.ts"), "utf8");
const audioHook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const BASE = "https://raw.githubusercontent.com/foonerd/evo-device-audio-artefacts/main/registries/evo-audio-prod/";

test("the refresh names the registered slug and nothing else; its answer echoes that slug", () => {
  assert.deepEqual(refreshRegistryPayload("evo-audio-prod"), { slug: "evo-audio-prod" });
  assert.deepEqual(Object.keys(refreshRegistryPayload("evo-audio-prod")), ["slug"]);
  assert.equal(decodeRefreshed({ plugin_registry_refreshed: true, slug: "evo-audio-prod", refreshed_at_ms: 1, plugin_count: 12 }), "evo-audio-prod");
  assert.equal(decodeRefreshed({ plugin_registry_refreshed: false, slug: "evo-audio-prod" }), null);
  assert.equal(decodeRefreshed({ plugin_registry_refreshed: true }), null);
  assert.equal(decodeRefreshed(null), null);
});

test("after a successful register: refresh once on the same write socket, then registered; a failed refresh is refused, never unregistered, never retried", () => {
  const c = code(hook);
  const flow = between(c, "const check = async (): Promise<void> => {", "\n  };");
  const at = (s: string): number => flow.indexOf(s);
  assert.ok(at("decodeRegistered(") > at("registerPluginRegistry(") && at("refreshPluginRegistry(") > at("decodeRegistered("), "the refresh follows a confirmed register");
  assert.equal((flow.match(/refreshPluginRegistry\(/g) ?? []).length, 1, "one refresh");
  assert.ok(/new PluginsAdminModule\(write\)\.refreshPluginRegistry\(refreshRegistryPayload\(slug\)\)/.test(flow), "the refresh rides the same write socket, for the registered slug");
  assert.equal((flow.match(/writeTransport\(\)/g) ?? []).length, 1, "one write socket for both");
  const tail = flow.slice(at("refreshPluginRegistry("));
  assert.ok(/if \(f\.error !== undefined\) \{\s*publish\(\{ kind: "refused", message: verbErrorMessage\(f\.error,[^)]*\) \}\);\s*return;\s*\}/.test(tail), "a failed refresh paints refused with its message");
  assert.ok(/if \(decodeRefreshed\(f\.value\) !== slug\) \{\s*publish\(\{ kind: "refused",[^}]*\}\);\s*return;\s*\}/.test(tail), "an unconfirmed refresh is refused too");
  assert.ok(at('publish({ kind: "registered", slug })') > at("refreshPluginRegistry("), "registered paints only after the refresh");
  assert.equal((flow.match(/publish\(\{ kind: "registered"/g) ?? []).length, 1);
  assert.ok(!/unregisterPluginRegistry|unregister_plugin_registry/.test(c), "a failed refresh never unregisters");
  assert.equal((flow.match(/registerPluginRegistry\(/g) ?? []).length, 1, "register is never sent again");
  assert.ok(!/step_up_token|stepUpToken|acquire\(|setToken\(/.test(c), "no second card is raised for the refresh: the glass adds none");
});

test("the triple comes from the host architecture; anything else is no triple", () => {
  assert.equal(targetTriple("aarch64"), "aarch64-unknown-linux-gnu");
  assert.equal(targetTriple("x86_64"), "x86_64-unknown-linux-gnu");
  assert.equal(targetTriple("armv7l"), "armv7-unknown-linux-gnueabihf");
  for (const other of ["armv6l", "i686", "riscv64", "AARCH64", "", null]) {
    assert.equal(targetTriple(other), null, `${JSON.stringify(other)} refuses`);
  }
});

test("the payload is the slug, the two URLs for the triple, and the pinned fingerprint - nothing else", () => {
  assert.equal(AUDIO_PROD_SLUG, "evo-audio-prod");
  assert.equal(AUDIO_REGISTRY_PREFIX, "evo-audio-");
  assert.equal(AUDIO_PROD_FINGERPRINT, "sha256:9cd7d7381ee7c2b3bfa490b39077afdc925192299dda661ef94dddba71e574da");
  for (const triple of ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "armv7-unknown-linux-gnueabihf"]) {
    const p = audioProdRegistration(triple);
    assert.deepEqual(p, {
      slug: "evo-audio-prod",
      manifest_url: BASE + triple + "/registry.toml",
      signature_url: BASE + triple + "/registry.sig",
      public_key_fingerprint: "sha256:9cd7d7381ee7c2b3bfa490b39077afdc925192299dda661ef94dddba71e574da"
    });
    assert.deepEqual(Object.keys(p), ["slug", "manifest_url", "signature_url", "public_key_fingerprint"]);
  }
});

test("the list decodes to slugs; an evo-audio- slug is the operator's channel; a failed list is not an empty one", () => {
  const listed = decodeRegistrySlugs({ plugin_registries: true, entries: [{ slug: "vendor-x" }, { slug: "evo-audio-test", manifest_url: "u" }] });
  assert.deepEqual(listed, ["vendor-x", "evo-audio-test"]);
  assert.deepEqual(audioRegistrySlugs(listed ?? []), ["evo-audio-test"]);
  assert.deepEqual(audioRegistrySlugs(["vendor-x", "evo-audiox"]), [], "only the evo-audio- prefix");
  assert.deepEqual(decodeRegistrySlugs({ plugin_registries: true, entries: [] }), [], "an empty answer is an empty list");
  assert.equal(decodeRegistrySlugs({ entries: "no" }), null, "not a list");
  assert.equal(decodeRegistrySlugs(null), null);
  assert.equal(decodeRegistered({ plugin_registry_registered: true, slug: "evo-audio-prod" }), "evo-audio-prod");
  assert.equal(decodeRegistered({ plugin_registry_registered: false }), null);
});

test("the view's flow: list first; present leaves it; a failed list or no triple registers nothing; register once through the step-up dispatch", () => {
  const c = code(hook);
  const flow = between(c, "const check = async (): Promise<void> => {", "\n  };");
  const at = (s: string): number => flow.indexOf(s);
  assert.ok(at("listPluginRegistries(") >= 0 && at("registerPluginRegistry(") > at("listPluginRegistries("), "the list goes first");
  assert.ok(at("audioRegistrySlugs(") > at("listPluginRegistries(") && at("audioRegistrySlugs(") < at("registerPluginRegistry("), "the check comes before any register");
  assert.ok(/if \(present\.length > 0\) \{\s*publish\(\{ kind: "present", slugs: present \}\);\s*return;\s*\}/.test(flow), "an evo-audio- registry is left alone");
  assert.ok(/if \(slugs === null\) \{\s*publish\(\{\s*kind: "listFailed",[\s\S]*?\}\);\s*return;\s*\}/.test(flow), "a failed list registers nothing");
  assert.ok(/if \(triple === null\) \{\s*publish\(\{ kind: "noTriple", architecture \}\);\s*return;\s*\}/.test(flow), "an unknown architecture refuses and registers nothing");
  assert.equal((flow.match(/registerPluginRegistry\(/g) ?? []).length, 1, "one register");
  assert.ok(/new PluginsAdminModule\(write\)\.registerPluginRegistry\(audioProdRegistration\(triple\)\)/.test(flow), "the existing step-up dispatch, with the payload helper");
  assert.ok(/new PluginsModule\(seed\)\.listPluginRegistries\(\)/.test(flow), "the list is a read on the seed socket");
  assert.ok(/pluginRequest\(seed, SYSTEM_INFO_SHELF, SYSTEM_INFO_VERBS\.info, SYSTEM_INFO_PAYLOAD\)/.test(flow) && /decodeSystemInfo\(/.test(flow), "the architecture is get_system_info's");
  assert.ok(/if \(r\.error !== undefined\) \{\s*publish\(\{ kind: "refused",/.test(flow), "a cancel or a refusal stays on this view");
  assert.ok(!/step_up_token|stepUpToken|acquire\(/.test(c), "the card is the existing dispatch's, not a second card");
  assert.ok(/if \(running === null\) \{[\s\S]*?running = runCheck\(\)\.finally\(\(\) => \{\s*running = null;/.test(c), "one check at a time, app-wide: a view that opens while one runs sends nothing");
  assert.equal((c.match(/[^ ]runCheck\(\)|= runCheck\(\)/g) ?? []).length, 1, "the check starts from one place");
  const pick = between(c, "const writeTransport = (): WsTransport | null => {", "\n  };");
  assert.ok(/powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"/.test(pick) && /bearerSource: storedBearer/.test(pick), "the register rides the step-up bearer rule");
  assert.ok(!/writeRequest|useAudioOptions/.test(c));
  assert.equal((audioHook.match(/await writeRequest\(/g) ?? []).length, 14, "the audio write-socket count is untouched");
});

test("only the Software update view registers; never on app boot; no channel picker; ComingSoon is off this view", () => {
  const update = between(app, '{activeView === "update" ? (', ") : null}");
  assert.ok(/<SoftwareUpdateSurface \/>/.test(update), "the view is the update surface");
  assert.ok(!/ComingSoonSurface/.test(update), "ComingSoon is off this view");
  assert.ok(!/register_plugin_registry|registerPluginRegistry|useSoftwareUpdate/.test(code(app).replace(/import \{ SoftwareUpdateSurface \}[^\n]*\n/, "")) && !/register_plugin_registry|registerPluginRegistry/.test(boot), "no register on app boot");
  assert.ok(/const \{ phase \} = useSoftwareUpdate\(\);/.test(view), "the view runs the check when it opens");
  assert.ok(!/<select|EvoSelect|type="radio"|role="radio"|channel picker/i.test(view), "no channel picker");
  assert.ok(!/useSoftwareUpdate|registerPluginRegistry/.test(code(readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8"))), "no other surface registers");
});

test("the dead update block on Operations is gone", () => {
  assert.ok(!/Core channel|Plugins channel|setUpdateChannel|applyUpdate|apply-core-update|apply-plugin-updates|updatesChannelStatus|updatesCoreStatus|updatesPluginsStatus|state\.updates/.test(ops), "no channel status, no channel buttons, no apply buttons");
  assert.ok(!/getUpdateStatus|UpdateStatusPayload|updates:/.test(opsState), "no dead update read");
  assert.ok(!/updatesChannelStatus|updatesCoreStatus|updatesPluginsStatus/.test(app), "the call site carries no update status");
  assert.ok(/setLogLevel|Toggle SSH/.test(ops), "the rest of Operations stays");
});

test("the strings exist, are ASCII, and carry no row id", () => {
  for (const key of ["update.title", "update.lede", "update.checking", "update.present", "update.registering", "update.registered", "update.refused", "update.listFailed", "update.noTriple", "update.channelNote"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(m[1]), key + " carries no row id");
  }
  for (const s of [helper, hook, view]) assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in source");
});

// ---- the steward and the artefacts, when their checkouts are beside this one

test("the steward reads slug / manifest_url / signature_url / public_key_fingerprint at step-up plugins_admin; the artefacts carry the three triples", (t) => {
  const repos = join(here, "..", "..", "..", "..", "..");
  const server = join(repos, "evo-core", "crates", "evo", "src", "server.rs");
  const schema = join(repos, "evo-core", "crates", "evo", "src", "projection_schema.rs");
  const reg = join(repos, "evo-device-audio-artefacts", "registries", "evo-audio-prod");
  if (!existsSync(server) || !existsSync(schema) || !existsSync(reg)) {
    t.skip("steward or artefacts checkout not beside this tree");
    return;
  }
  const s = readFileSync(server, "utf8");
  const req = between(s, "RegisterPluginRegistry {", "},");
  for (const f of ["slug: String", "manifest_url: String", "signature_url: String", "public_key_fingerprint: String", "poll_interval_secs: Option<u64>"]) {
    assert.ok(req.includes(f), f);
  }
  assert.ok(/s\.step_up\(\s*"register_plugin_registry",\s*"plugins_admin",/.test(readFileSync(schema, "utf8")), "register is step-up at plugins_admin");
  assert.ok(/s\.write\(\s*"refresh_plugin_registry",\s*"plugins_admin",/.test(readFileSync(schema, "utf8")), "refresh is a write at plugins_admin, not step-up");
  assert.ok(/RefreshPluginRegistry \{\s*\/\/\/[^\n]*\n\s*slug: String,\s*\}/.test(s), "refresh reads the slug alone");
  assert.ok(/plugin_registry_refreshed: bool,\s*\/\/\/[^\n]*\n\s*slug: String,/.test(s), "the refresh answer echoes the slug");
  for (const triple of ["aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "armv7-unknown-linux-gnueabihf"]) {
    const toml = readFileSync(join(reg, triple, "registry.toml"), "utf8");
    assert.ok(existsSync(join(reg, triple, "registry.sig")), triple + " is signed");
    assert.ok(toml.includes(`public_key_fingerprint = "${AUDIO_PROD_FINGERPRINT}"`), triple + " names the pinned key");
    assert.ok(toml.includes(`manifest_url = "${BASE}${triple}/registry.toml"`), triple + " names its own manifest URL");
  }
});
