// Contract: About reads the host and the installed release. Two reads on
// shelf system.info - get_system_info and get_system_version, payload
// { v: 1 } - through pluginRequest on the shared page-lifetime socket (the
// one get_display_state uses), one read of each verb when About is shown.
// They are not write sites; the audio write-socket count stays 14.
// get_system_info paints hostname, os, kernel, the host architecture,
// model, cpu model, cores, memory in bytes and uptime in whole seconds;
// get_system_version paints release, build, the bundle architecture and
// built_at_utc. A null field paints the unknown string. The software
// version is release - never the health version and never build. A
// refused read leaves what About is already showing. The status line, the
// live-updates line and the credits stay.
// Run:
//   node --experimental-strip-types --test tests/contracts/about-system-info.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SYSTEM_INFO_PAYLOAD,
  SYSTEM_INFO_SHELF,
  SYSTEM_INFO_VERBS,
  decodeSystemInfo,
  decodeSystemVersion,
  memoryGiB,
  softwareVersion,
  uptimeParts
} from "../../src/features/system/system-info.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "system", "useSystemInfo.ts"), "utf8");
const helper = readFileSync(join(root, "features", "system", "system-info.ts"), "utf8");
const surface = readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8");
const audioHook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const socketPin = readFileSync(join(here, "audio-write-socket.test.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the shelf, the two read verbs, the payload", () => {
  assert.equal(SYSTEM_INFO_SHELF, "system.info");
  assert.deepEqual(SYSTEM_INFO_VERBS, { info: "get_system_info", version: "get_system_version" });
  assert.deepEqual(SYSTEM_INFO_PAYLOAD, { v: 1 });
});

test("get_system_info decodes every field; a null or missing field is null", () => {
  const full = decodeSystemInfo({
    v: 1, hostname: "player", os: "Debian GNU/Linux 12", kernel: "6.6.31", architecture: "aarch64",
    model: "Board Model", cpu: { model: "Cortex-A76", cores: 4 }, memory_total_bytes: 8_000_000_000, uptime_s: 93784
  });
  assert.deepEqual(full, {
    hostname: "player", os: "Debian GNU/Linux 12", kernel: "6.6.31", architecture: "aarch64",
    model: "Board Model", cpuModel: "Cortex-A76", cpuCores: 4, memoryTotalBytes: 8_000_000_000, uptimeS: 93784
  });
  const empty = decodeSystemInfo({ v: 1, hostname: null, os: null, kernel: null, architecture: null, model: null, cpu: { model: null, cores: null }, memory_total_bytes: null, uptime_s: null });
  assert.deepEqual(empty, { hostname: null, os: null, kernel: null, architecture: null, model: null, cpuModel: null, cpuCores: null, memoryTotalBytes: null, uptimeS: null });
  assert.deepEqual(decodeSystemInfo({ v: 1 })?.cpuModel, null, "a missing cpu is null, not a guess");
  assert.equal(decodeSystemInfo({ v: 1, uptime_s: 12.5 })?.uptimeS, null, "uptime is whole seconds or null");
  assert.equal(decodeSystemInfo({ v: 1, memory_total_bytes: -4 })?.memoryTotalBytes, null);
  assert.equal(decodeSystemInfo(null), null);
});

test("get_system_version decodes; the software version is release, never build, never filled", () => {
  const v = decodeSystemVersion({ v: 1, release: "7.3.2", build: "7.3.1", architecture: "arm64", built_at_utc: "2026-10-28T09:00:00Z" });
  assert.deepEqual(v, { release: "7.3.2", build: "7.3.1", architecture: "arm64", builtAtUtc: "2026-10-28T09:00:00Z" });
  assert.equal(softwareVersion(v), "7.3.2");
  const noRelease = decodeSystemVersion({ v: 1, release: null, build: "7.3.1", architecture: null, built_at_utc: null });
  assert.ok(noRelease !== null);
  assert.equal(noRelease.release, null);
  assert.equal(softwareVersion(noRelease), null, "a null release is not filled from the build");
  assert.equal(softwareVersion(null), null, "no answer, no version");
  assert.equal(decodeSystemVersion(null), null);
  const fn = code(helper).slice(code(helper).indexOf("export function softwareVersion("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(!/build|health/.test(body.replace(/softwareVersion|SystemVersion/g, "")), "softwareVersion reads release only");
});

test("memory and uptime keep their exact values", () => {
  assert.equal(memoryGiB(8_589_934_592), "8.00");
  assert.deepEqual(uptimeParts(93784), { d: 1, h: 2, m: 3 });
  assert.deepEqual(uptimeParts(59), { d: 0, h: 0, m: 0 });
});

test("the hook: one read of each verb on the shared socket through pluginRequest, { v: 1 }; not a write site; a refused read changes nothing", () => {
  const c = code(hook);
  assert.ok(/const transport = tryUseFrameworkTransport\(\);/.test(c), "the shared page-lifetime socket");
  assert.ok(!/new WsTransport|writeRequest|writeTransport|storedBearer|bearerSource|setBearerToken|dispatchSetter/.test(c), "no private socket, no bearer, no write site");
  assert.ok(/pluginRequest\(\s*transport,\s*SYSTEM_INFO_SHELF,\s*SYSTEM_INFO_VERBS\.info,\s*SYSTEM_INFO_PAYLOAD\s*\)/.test(c));
  assert.ok(/pluginRequest\(\s*transport,\s*SYSTEM_INFO_SHELF,\s*SYSTEM_INFO_VERBS\.version,\s*SYSTEM_INFO_PAYLOAD\s*\)/.test(c));
  assert.equal((c.match(/pluginRequest\(/g) ?? []).length, 2, "one read of each verb");
  assert.ok(/\}, \[transport\]\);/.test(c), "read when About is shown, not on every render");
  assert.ok(!/setInterval|setTimeout/.test(c), "no standing poll");
  assert.equal((c.match(/if \(cancelled \|\| r\.error !== undefined\) return;/g) ?? []).length, 2, "a refused read leaves what is showing");
  assert.ok(!/setInfo\(null\)|setVersion\(null\)/.test(c), "a refused read never blanks About");
  assert.equal((audioHook.match(/await writeRequest\(/g) ?? []).length, 14, "the audio write-socket count stays 14");
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(!/get_system_info|get_system_version|system\.info/.test(audioHook + socketPin), "neither verb is a write site");
});

test("About paints the release as the software version, never the health version or the build; nulls paint unknown; status, live updates and credits stay", () => {
  const about = between(surface, "function AboutGroup(", "/* ---------- System group");
  assert.ok(/const \{ info, version \} = useSystemInfo\(\);/.test(about));
  assert.ok(!/health\?\.version|health\.version/.test(about), "the software version is never the health version");
  assert.ok(/<dt>\{t\("settings\.about\.version"\)\}<\/dt>\s*<dd>\{known\(softwareVersion\(version\)\)\}<\/dd>/.test(about), "the software version is the release");
  assert.ok(/<dd>\{known\(version\?\.build \?\? null\)\}<\/dd>/.test(about), "the build is its own row");
  for (const f of ["info?.hostname", "info?.os", "info?.kernel", "info?.architecture", "info?.model", "info?.cpuModel", "version?.architecture", "version?.builtAtUtc"]) {
    assert.ok(about.includes(f), f + " is painted");
  }
  assert.ok(/info\?\.cpuCores/.test(about) && /info\?\.memoryTotalBytes/.test(about) && /info\?\.uptimeS/.test(about));
  assert.ok(/const known = \(v: string \| null \| undefined\): string =>\s*v === null \|\| v === undefined \|\| v === "" \? t\("settings\.unknown"\) : v;/.test(about), "a null field paints the unknown string");
  assert.ok(/<dd>\{health\?\.status \?\? t\("settings\.unknown"\)\}<\/dd>/.test(about), "the status line stays");
  assert.ok(/streamOpen \? t\("settings\.about\.active"\) : t\("settings\.about\.offline"\)/.test(about), "the live-updates line stays");
  assert.ok(/<CreditsPanel \/>/.test(about), "the credits stay");
});

test("the strings exist, are ASCII, and carry no row id", () => {
  for (const key of ["settings.about.hostname", "settings.about.os", "settings.about.kernel", "settings.about.hostArch", "settings.about.model", "settings.about.cpuModel", "settings.about.cpuCores", "settings.about.memory", "settings.about.memoryValue", "settings.about.uptime", "settings.about.uptimeValue", "settings.about.build", "settings.about.bundleArch", "settings.about.builtAt"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(m[1]), key + " carries no row id");
  }
  for (const s of [helper, hook]) assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in source");
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin answers the fields the glass reads, on shelf system.info", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.system.info", "src", "lib.rs");
  const mf = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.system.info", "manifest.toml");
  if (!existsSync(rs) || !existsSync(mf)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const info = [...between(s, "pub struct SystemInfo {", "\n}").matchAll(/pub (\w+): /g)].map((m) => m[1]);
  assert.deepEqual(info, ["hostname", "os", "kernel", "architecture", "model", "cpu", "memory_total_bytes", "uptime_s"]);
  const cpu = [...between(s, "pub struct Cpu {", "\n}").matchAll(/pub (\w+): /g)].map((m) => m[1]);
  assert.deepEqual(cpu, ["model", "cores"]);
  const ver = between(s, "pub struct SystemVersion {", "\n}");
  assert.ok(/pub release: Option<String>/.test(ver) && /pub build: String/.test(ver) && /pub architecture: Option<String>/.test(ver) && /pub built_at_utc: Option<String>/.test(ver));
  assert.ok(/shelf = "system\.info"/.test(readFileSync(mf, "utf8")));
  assert.ok(s.includes('"get_system_info"') && s.includes('"get_system_version"'));
});
