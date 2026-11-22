// Contract: the operator exports and imports a backup. The Backup stage
// replaces its placeholder. export_backup and import_backup on shelf
// system.backup ride the same bearer rule as reboot_device - a stored
// bearer goes on a private socket that presents it, and with no bearer
// they stay on the hook's anonymous seed socket. They are not the audio
// write path; the audio write-socket count stays 14. Export sends { v: 1 }
// and the answered backup is what the screen holds; a paste replaces what
// the screen holds and sends nothing. Import asks first; cancel sends
// nothing; import sends { v: 1, backup } with the backup on screen, and a
// backup that does not parse sends nothing. The answer's refused list is
// painted; an empty list means every item went back. A refused verb leaves
// the backup on screen. While the stage is locked (a verb in flight)
// neither button sends. No password and no share in the payload.
// Run:
//   node --experimental-strip-types --test tests/contracts/system-backup.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BACKUP_SHELF,
  BACKUP_VERBS,
  backupText,
  decodeExportAnswer,
  decodeImportAnswer,
  exportBackupPayload,
  importBackupPayload,
  parseBackupText
} from "../../src/features/system/backup.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "system", "useSystemBackup.ts"), "utf8");
const panel = readFileSync(join(root, "features", "system", "BackupPanel.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "system", "backup.ts"), "utf8");
const surface = readFileSync(join(root, "features", "system", "SystemSurface.tsx"), "utf8");
const power = readFileSync(join(root, "features", "system", "useSystemPower.ts"), "utf8");
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

const sample = { v: 1, config: { logical_outputs: [], zones: [] }, playlists: [{ name: "Evening", m3u: "#EXTM3U\n" }], settings: { record: {}, eq_presets: [] } };

test("the shelf, the two verbs, the payloads - { v: 1 } and { v: 1, backup }, nothing else", () => {
  assert.equal(BACKUP_SHELF, "system.backup");
  assert.deepEqual(BACKUP_VERBS, { export: "export_backup", import: "import_backup" });
  assert.deepEqual(exportBackupPayload(), { v: 1 });
  assert.deepEqual(Object.keys(exportBackupPayload()), ["v"]);
  const p = importBackupPayload(sample);
  assert.deepEqual(Object.keys(p), ["v", "backup"]);
  assert.equal(p.v, 1);
  assert.equal(p.backup, sample, "the backup on screen, as parsed");
  assert.ok(!/password|passwd|secret|share/i.test(code(helper).replace(/system\.backup|BACKUP_SHELF/g, "")), "the glass names no password and no share");
});

test("a backup on screen parses to an object; anything else does not parse", () => {
  assert.deepEqual(parseBackupText(backupText(sample)), sample, "export text round-trips");
  assert.equal(parseBackupText(""), null);
  assert.equal(parseBackupText("   "), null);
  assert.equal(parseBackupText("{ not json"), null);
  assert.equal(parseBackupText("[1,2]"), null, "a list is not a backup");
  assert.equal(parseBackupText("42"), null);
  assert.equal(parseBackupText("null"), null);
});

test("the answers decode: export answers the backup; import answers the refused list", () => {
  assert.deepEqual(decodeExportAnswer({ v: 1, backup: sample }), sample);
  assert.equal(decodeExportAnswer({ v: 1 }), null);
  assert.equal(decodeExportAnswer({ v: 1, backup: [1] }), null);
  assert.deepEqual(decodeImportAnswer({ v: 1, refused: [] }), [], "every item went back");
  assert.deepEqual(decodeImportAnswer({ v: 1, refused: [{ domain: "config", item: "zone Hall", reason: "name taken" }] }), [{ domain: "config", item: "zone Hall", reason: "name taken" }]);
  assert.equal(decodeImportAnswer({ v: 1 }), null, "no list is not an answer");
  assert.equal(decodeImportAnswer({ v: 1, refused: [{ domain: "config" }] }), null, "a row that is not a refusal is not an answer");
});

test("the bearer rule is reboot's: a stored bearer rides a private socket; no bearer stays on the seed socket; not the audio write path", () => {
  const c = code(hook);
  assert.ok(/import \{ powerWriteSocket \} from "\.\/power-write-socket";/.test(hook), "the same rule function as the power verbs");
  const pick = between(c, "const writeTransport = useCallback(", "}, [seedTransport]);");
  assert.ok(/if \(powerWriteSocket\(storedBearer\(\) !== undefined\) === "seed"\) \{\s*return seedTransport\(\);\s*\}/.test(pick), "only the no-bearer case returns the seed socket");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\), bearerSource: storedBearer \}\)/.test(pick), "the write socket reads the stored bearer at every handshake");
  assert.ok(!/\?\? seedTransport\(\)|seedRef\.current/.test(pick.slice(pick.indexOf("let tx"))), "with a bearer the pick never falls back to the seed socket");
  const seed = between(c, "const seedTransport = useCallback(", "}, []);");
  assert.ok(/new WsTransport\(\{ url: frameworkWsUrl\(\) \}\)/.test(seed) && !/bearer/i.test(seed), "the seed socket is anonymous");
  assert.equal((c.match(/bearerSource/g) ?? []).length, 1, "one bearer socket");
  assert.ok(/onBearerChange\(/.test(c) && /\.rotateBearer\(\)/.test(c), "a pair or a purge re-handshakes the bearer socket");
  assert.ok(/void tx\.close\(\)/.test(c) && /void seed\.close\(\)/.test(c), "both sockets close on unmount");
  assert.ok(!/tryUseFrameworkTransport|useFrameworkTransport|setBearerToken|writeRequest|useAudioOptions/.test(c), "never the shared socket, never a pinned token, never the audio write path");
  assert.ok(/pluginRequest\(transport, BACKUP_SHELF, BACKUP_VERBS\.export, exportBackupPayload\(\)\)/.test(c));
  assert.ok(/pluginRequest\(transport, BACKUP_SHELF, BACKUP_VERBS\.import, importBackupPayload\(backup\)\)/.test(c));
  assert.equal((c.match(/pluginRequest\(/g) ?? []).length, 2, "one send per verb");
  assert.equal((c.match(/const transport = writeTransport\(\);/g) ?? []).length, 2, "each verb picks its socket by the rule");
  assert.ok(!/system\.backup|export_backup|import_backup/.test(audioHook + socketPin), "neither verb rides the audio write path");
  assert.equal((audioHook.match(/await writeRequest\(/g) ?? []).length, 14, "the audio write-socket count stays 14");
  assert.ok(/length, 14,/.test(socketPin));
  assert.ok(!/backup/i.test(power), "reboot and power-off stay on their own socket; the power hook is untouched");
});

test("the stage: export fills the screen; a paste replaces it and sends nothing; import asks first, cancel sends nothing, an unparsed backup sends nothing; a refusal leaves the screen; locked sends nothing", () => {
  assert.ok(/if \(id === "backup"\) \{\s*return \(\s*<>\s*\{header\}\s*<BackupPanel \/>\s*<\/>\s*\);\s*\}/.test(surface), "the Backup stage replaces the placeholder");
  const exp = between(panel, "const onExport = async", "\n  };");
  assert.ok(/if \(locked\) return;/.test(exp), "locked sends nothing");
  assert.equal((exp.match(/exportBackup\(/g) ?? []).length, 1, "export sends once");
  assert.ok(/if \(r\.ok\) \{\s*setText\(backupText\(r\.value\)\);/.test(exp), "the answered backup is what the screen holds");
  assert.ok(/\} else \{\s*setError\(r\.message\);\s*\}/.test(exp) && (exp.match(/setText\(/g) ?? []).length === 1, "a refused export leaves the screen");
  assert.ok(/onInput=\{\(ev\) => setText\(\(ev\.currentTarget as HTMLTextAreaElement\)\.value\)\}/.test(panel), "a paste replaces what the screen holds");
  assert.ok(!/onInput=\{[^}]*(exportBackup|importBackup|onExport|onImport)/.test(panel), "a paste sends nothing");
  const ask = between(panel, "const onAskImport = ()", "\n  };");
  assert.ok(/if \(locked\) return;/.test(ask));
  assert.ok(/if \(parseBackupText\(text\) === null\) return;/.test(ask), "a backup that does not parse never reaches the ask");
  assert.ok(/setImportAsk\(true\)/.test(ask) && !/importBackup\(/.test(ask), "the button only asks");
  const imp = between(panel, "const onConfirmImport = async", "\n  };");
  assert.ok(/setImportAsk\(false\);/.test(imp));
  assert.ok(/if \(locked\) return;/.test(imp));
  assert.ok(/const backup = parseBackupText\(text\);\s*if \(backup === null\) return;/.test(imp), "the backup on screen, parsed, or nothing");
  assert.equal((imp.match(/importBackup\(/g) ?? []).length, 1, "import sends once");
  assert.ok(/await importBackup\(backup\)/.test(imp));
  assert.ok(!/setText\(/.test(imp), "import never changes the screen");
  assert.ok(/if \(r\.ok\) \{\s*setRefused\(r\.value\);\s*\} else \{\s*setError\(r\.message\);\s*\}/.test(imp));
  assert.ok(/onCancel=\{\(\) => setImportAsk\(false\)\}/.test(panel), "cancel sends nothing");
  assert.ok(/const locked = busy;/.test(panel));
  const shown = between(panel, "{refused !== null ? (", ") : null}");
  assert.ok(/refused\.length === 0/.test(shown) && /t\("settings\.backup\.allBack"\)/.test(shown), "an empty list means every item went back");
  assert.ok(/refused\.map\(/.test(shown) && /r\.domain/.test(shown) && /r\.item/.test(shown) && /r\.reason/.test(shown), "each refusal is painted");
});

test("the strings exist, are ASCII, and carry no row id", () => {
  for (const key of ["settings.backup.export", "settings.backup.import", "settings.backup.textLabel", "settings.backup.textHint", "settings.backup.notParsed", "settings.backup.importTitle", "settings.backup.importAsk", "settings.backup.allBack", "settings.backup.refusedTitle", "settings.backup.refusedRow", "settings.system.summary.backup"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/\b[A-Z][0-9]\b/.test(m[1]), key + " carries no row id");
  }
  for (const s of [helper, hook, panel]) assert.ok(!/\b[A-Z][0-9]\b/.test(s), "no row id in source");
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, backup } on import, answers backup and refused, and gates both verbs at system_admin", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.system.backup", "src", "lib.rs");
  const mf = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.system.backup", "manifest.toml");
  if (!existsSync(rs) || !existsSync(mf)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const m = readFileSync(mf, "utf8");
  const fields = [...between(s, "struct ImportPayload {", "\n}").matchAll(/^\s+(\w+): /gm)].map((x) => x[1]);
  assert.deepEqual(fields, ["v", "backup"]);
  assert.ok(/"backup": backup/.test(s) && /"refused": refused/.test(s));
  const refused = [...between(s, "pub struct Refused {", "\n}").matchAll(/pub (\w+): /g)].map((x) => x[1]);
  assert.deepEqual(refused, ["domain", "item", "reason"]);
  assert.ok(/shelf = "system\.backup"/.test(m));
  // Write-rank lift (named, authorised with the E1c docs-truth row): the
  // backup and power verbs moved from step-up rank to write:system_admin
  // together, with the household policy as the door on top.
  assert.ok(/export_backup = \{ kind = "write", scope = "system_admin" \}/.test(m) && /import_backup = \{ kind = "write", scope = "system_admin" \}/.test(m), "the same gate as the power verbs");
});
