// Contract (G2): the operator can name a physical output. Under the
// physical rows on the output stage, a list from
// delivery.list_logical_outputs, asked with { v } only and shown in the
// answer's order; an empty answer is an empty list. Add asks for a name and
// one physical output the list already shows and sends
// delivery.add_logical_output with { name, output_id } and nothing else; an
// empty name is not sent. Update sends delivery.update_logical_output with
// that row's id and the new name, the new physical output, or both. Remove
// asks, then sends delivery.remove_logical_output with { id } only; cancel
// sends nothing. After each answer the list on screen is that answer; there
// is no second read except the list that opened the stage. A named output is
// not played, paused, or given a volume from these controls; the five
// controls on a physical row still send that row's hw:N,M id; the picker
// stays options.set_output_device.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-named-outputs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOGICAL_OUTPUT_VERBS,
  addLogicalOutputPayload,
  updateLogicalOutputPayload,
  removeLogicalOutputPayload,
  decodeLogicalOutput,
  decodeLogicalOutputAnswer,
  decodeLogicalOutputList,
  withAdded,
  withUpdated,
  withRemoved
} from "../../src/features/audio/logical-output-verbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const list = readFileSync(join(root, "features", "audio", "LogicalOutputList.tsx"), "utf8");
const physicalRow = readFileSync(join(root, "features", "audio", "OutputControlRow.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "logical-output-verbs.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const hall = { id: "logical:1", name: "Hall", outputId: "hw:0,0" };
const study = { id: "logical:2", name: "Study", outputId: "hw:1,0" };

test("four verbs; add sends name and output_id and nothing else, and an empty name is not sent", () => {
  assert.deepEqual(LOGICAL_OUTPUT_VERBS, {
    list: "delivery.list_logical_outputs",
    add: "delivery.add_logical_output",
    update: "delivery.update_logical_output",
    remove: "delivery.remove_logical_output"
  });
  assert.deepEqual(addLogicalOutputPayload("Hall", "hw:0,0"), { name: "Hall", output_id: "hw:0,0" });
  assert.deepEqual(Object.keys(addLogicalOutputPayload("Hall", "hw:0,0") ?? {}), ["name", "output_id"]);
  assert.deepEqual(addLogicalOutputPayload("  Hall ", "hw:0,0"), { name: "Hall", output_id: "hw:0,0" }, "the name is trimmed");
  assert.equal(addLogicalOutputPayload("", "hw:0,0"), null, "an empty name is not sent");
  assert.equal(addLogicalOutputPayload("   ", "hw:0,0"), null, "a blank name is not sent");
  assert.equal(addLogicalOutputPayload("Hall", ""), null, "no physical output, no send");
  for (const key of ["id", "volume", "value", "device", "verb", "mode", "target"]) {
    assert.ok(!(key in (addLogicalOutputPayload("Hall", "hw:0,0") ?? {})), key + " is never sent on add");
  }
});

test("update sends that row's id and only what changed; nothing changed is nothing sent", () => {
  assert.equal(updateLogicalOutputPayload(hall, { name: "Hall", outputId: "hw:0,0" }), null, "unchanged: nothing is sent");
  assert.deepEqual(updateLogicalOutputPayload(hall, { name: "Lounge", outputId: "hw:0,0" }), { id: "logical:1", name: "Lounge" });
  assert.deepEqual(updateLogicalOutputPayload(hall, { name: "Hall", outputId: "hw:1,0" }), { id: "logical:1", output_id: "hw:1,0" });
  assert.deepEqual(updateLogicalOutputPayload(hall, { name: "Lounge", outputId: "hw:1,0" }), { id: "logical:1", name: "Lounge", output_id: "hw:1,0" });
  assert.deepEqual(updateLogicalOutputPayload(hall, { name: " Hall ", outputId: "hw:0,0" }), null, "a respelling with spaces is the same name");
  assert.equal(updateLogicalOutputPayload(hall, { name: "", outputId: "hw:1,0" }), null, "an empty name is not sent, even with a new output");
  assert.equal(updateLogicalOutputPayload(hall, { name: "Lounge", outputId: "" }), null, "no physical output, no send");
  const both = updateLogicalOutputPayload(hall, { name: "Lounge", outputId: "hw:1,0" }) ?? {};
  for (const key of Object.keys(both)) {
    assert.ok(["id", "name", "output_id"].includes(key), key + " is never sent on update");
  }
});

test("remove sends the id and nothing else", () => {
  assert.deepEqual(removeLogicalOutputPayload("logical:1"), { id: "logical:1" });
  assert.deepEqual(Object.keys(removeLogicalOutputPayload("logical:1")), ["id"]);
});

test("the helper names no physical-row verb and no picker verb", () => {
  const h = code(helper);
  assert.ok(!/enable_output|disable_output|play_output|pause_output|set_output_volume/.test(h), "the five G1 verbs are not here");
  assert.ok(!/set_output_device|options\./.test(h), "the picker is not here");
  assert.ok(!/set_volume\b|startup_volume|max_volume/.test(h), "no volume of any kind is here");
});

test("the answers decode: one row from add, update, remove; every row in the answer's order from the list", () => {
  assert.deepEqual(decodeLogicalOutput({ id: "logical:1", name: "Hall", output_id: "hw:0,0" }), hall);
  assert.equal(decodeLogicalOutput({ name: "Hall", output_id: "hw:0,0" }), null, "no id is not a row");
  assert.equal(decodeLogicalOutput({ id: "logical:1", output_id: "hw:0,0" }), null, "no name is not a row");
  assert.equal(decodeLogicalOutput({ id: "logical:1", name: "Hall" }), null, "no output is not a row");
  assert.deepEqual(decodeLogicalOutputAnswer({ v: 1, logical_output: { id: "logical:1", name: "Hall", output_id: "hw:0,0" } }), hall);
  assert.equal(decodeLogicalOutputAnswer({ v: 1 }), null);
  assert.equal(decodeLogicalOutputAnswer(null), null);
  assert.deepEqual(
    decodeLogicalOutputList({ v: 1, logical_outputs: [{ id: "logical:2", name: "Study", output_id: "hw:1,0" }, { id: "logical:1", name: "Hall", output_id: "hw:0,0" }] }),
    [study, hall],
    "the answer's order, not a sort of the glass's own"
  );
  assert.deepEqual(decodeLogicalOutputList({ v: 1, logical_outputs: [] }), [], "an empty answer is an empty list");
  assert.deepEqual(decodeLogicalOutputList({ v: 1 }), []);
  assert.deepEqual(decodeLogicalOutputList(null), []);
  assert.deepEqual(decodeLogicalOutputList({ v: 1, logical_outputs: [{ id: "logical:1", name: "Hall", output_id: "hw:0,0" }, { nonsense: true }] }), [hall], "what is not a row is not painted");
});

test("after each answer the list is that answer: the new row, the updated row, or the row taken away", () => {
  assert.deepEqual(withAdded([hall], study), [hall, study]);
  const lounge = { id: "logical:1", name: "Lounge", outputId: "hw:1,0" };
  assert.deepEqual(withUpdated([hall, study], lounge), [lounge, study], "replaced by id, the other row as it was");
  assert.deepEqual(withRemoved([hall, study], hall), [study]);
  assert.deepEqual(withRemoved([study], hall), [study], "a row not in the list leaves the list as it was");
  assert.deepEqual(withUpdated([study], lounge), [study], "an update to a row not listed changes nothing");
});

test("the hook: the list is read once, with { v }, when the stage opens, and never again", () => {
  const read = between(hook, "const readLogicalOutputs = useCallback(", "\n  );");
  assert.ok(/pluginRequest\(\s*transport,\s*DELIVERY_SHELF,\s*LOGICAL_OUTPUT_VERBS\.list,\s*\{ v: PAYLOAD_VERSION \}\s*\)/.test(read), "the delivery shelf, the list verb, { v } and nothing else");
  assert.ok(/setLogicalOutputs\(decodeLogicalOutputList\(result\.value\)\)/.test(read), "the answer is decoded and is the list");
  assert.equal((code(hook).match(/LOGICAL_OUTPUT_VERBS\.list/g) ?? []).length, 1, "the list verb is sent from one place");
  const seed = between(hook, "const seed = async (): Promise<void> => {", "// Happening handler");
  assert.ok(/await refreshOutputDevices\(transport\);\s*if \(cancelled\) return;\s*await readLogicalOutputs\(transport\);/.test(seed), "read with the list that opened the stage, after the physical rows");
  assert.equal((code(hook).match(/readLogicalOutputs\(/g) ?? []).length, 1, "no second read anywhere");
});

test("the hook: one write site for the three verbs; the answer is decoded and becomes the list; no re-read rides along", () => {
  const block = between(hook, "const logicalOutputVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1, "one write site for the three verbs");
  assert.ok(/await writeRequest\(DELIVERY_SHELF, requestType, \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "the delivery shelf, the versioned envelope, the helper's payload");
  assert.ok(/decodeLogicalOutputAnswer\(result\.value\)/.test(block), "the answer is decoded, not trusted");
  assert.ok(/setLogicalOutputs\(\(cur\) => apply\(cur, row\)\)/.test(block), "the list becomes the answer");
  assert.ok(!/readLogicalOutputs|refreshSettings|refreshOutputDevices|set_output_device|OPTIONS_SHELF|OUTPUT_VERBS\./.test(block), "no second read, no options re-read, no picker verb, no physical-row verb");
  assert.ok(/const addLogicalOutput = useCallback\(\s*\(payload: AddLogicalOutputPayload\) => logicalOutputVerb\(LOGICAL_OUTPUT_VERBS\.add, payload, withAdded\)/.test(hook));
  assert.ok(/const updateLogicalOutput = useCallback\(\s*\(payload: UpdateLogicalOutputPayload\) => logicalOutputVerb\(LOGICAL_OUTPUT_VERBS\.update, payload, withUpdated\)/.test(hook));
  assert.ok(/const removeLogicalOutput = useCallback\(\s*\(payload: RemoveLogicalOutputPayload\) => logicalOutputVerb\(LOGICAL_OUTPUT_VERBS\.remove, payload, withRemoved\)/.test(hook));
  assert.equal((code(hook).match(/delivery\.(add|update|remove)_logical_output|delivery\.list_logical_outputs/g) ?? []).length, 0, "the verbs are named once, in the helper");
  assert.ok(/options\.set_output_device/.test(hook), "the picker's verb is still the picker's");
});

test("the list: names in the answer's order; add, update and remove through the helper's payloads; cancel sends nothing", () => {
  const l = code(list);
  assert.ok(/rows\.length === 0/.test(l) && /rows\.map\(\(row\) =>/.test(l), "the rows as answered, or the empty line");
  assert.ok(!/\.sort\(/.test(l), "the glass does not reorder the answer");
  assert.ok(/const payload = addLogicalOutputPayload\(addName, addTargetValue\);\s*if \(payload === null\) return;/.test(l), "add refuses before any send");
  assert.ok(/await props\.onAdd\(payload\)/.test(l));
  assert.ok(/const payload = updateLogicalOutputPayload\(row, \{ name: editName, outputId: editTarget \}\);\s*if \(payload === null\) return;/.test(l), "an unchanged or unnamed row sends nothing");
  assert.ok(/await props\.onUpdate\(payload\)/.test(l));
  assert.ok(/const payload = removeLogicalOutputPayload\(removeAsk\.id\);/.test(l) && /await props\.onRemove\(payload\)/.test(l), "remove sends the asked row's id");
  assert.ok(/<ConfirmDialog/.test(l), "remove asks first");
  assert.ok(/onCancel=\{\(\) => setRemoveAsk\(null\)\}/.test(l), "cancel closes the ask and sends nothing");
  assert.ok(!/onEnable|onDisable|onPlay|onPause|onVolume|type="range"/.test(l), "no play, pause, enable, disable or volume on a named row");
  assert.ok(!/OutputControlRow|"\.\/output-verbs"|OUTPUT_VERBS|enable_output|disable_output|play_output|pause_output|set_output_volume/.test(l), "the physical-row verbs are not here");
  assert.ok(!/set_output_device|onPickDevice|setOutputDevice|selectedOutput/.test(l), "the picker is not here");
  assert.ok(/options=\{targetOptions\(outputs, null\)\}/.test(l), "add offers the physical outputs the stage lists");
});

test("the stage: the named list sits under the physical rows; the physical rows and the picker are as they were", () => {
  const named = between(panel, "{/* end audio-output-rows */}", "{/* end audio-named-outputs */}");
  assert.ok(/<LogicalOutputList/.test(named));
  assert.ok(/rows=\{logicalOutputs\}/.test(named) && /outputs=\{outputsInClass\}/.test(named), "the names, and the physical rows the stage lists");
  assert.ok(/onAdd=\{addLogicalOutput\}/.test(named) && /onUpdate=\{updateLogicalOutput\}/.test(named) && /onRemove=\{removeLogicalOutput\}/.test(named));
  const physical = between(panel, 'className="audio-output-rows"', "{/* end audio-output-rows */}");
  assert.ok(/outputsInClass\.map\(\(o\) =>/.test(physical) && /<OutputControlRow/.test(physical) && /output=\{o\}/.test(physical), "the physical rows are the listed outputs");
  assert.ok(!/logical/i.test(physical), "no named output reaches a physical row");
  assert.ok(!/logical/i.test(code(physicalRow)), "a physical row's id is never a logical id");
  assert.ok(/onChange=\{\(v\) => void onPickDevice\(v\)\}/.test(panel), "the picker stays the picker");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["audioopt.namedOutputs", "audioopt.namedEmpty", "audioopt.namedName", "audioopt.namedNamePlaceholder", "audioopt.namedTarget", "audioopt.namedAdd", "audioopt.namedUpdate", "audioopt.namedSave", "audioopt.namedRemove", "audioopt.namedRemoveTitle", "audioopt.namedRemoveAsk", "audioopt.namedNotListed"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's named-output requests read v + name + output_id, v + id (+ name, output_id), v + id; and answer { v, logical_output } and { v, logical_outputs }", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "lib.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const add = between(s, "struct AddLogicalOutputRequest {", "\n}");
  assert.ok(/name: String/.test(add) && /output_id: String/.test(add) && !/\bid: String/.test(add), "add reads name and output_id");
  const upd = between(s, "struct UpdateLogicalOutputRequest {", "\n}");
  assert.ok(/\bid: String/.test(upd) && /name: Option<String>/.test(upd) && /output_id: Option<String>/.test(upd), "update reads the id and what changes");
  const rem = between(s, "struct RemoveLogicalOutputRequest {", "\n}");
  assert.ok(/\bid: String/.test(rem) && !/name|output_id/.test(rem), "remove reads the id only");
  assert.ok(/struct LogicalOutputResponse \{\s*v: u32,\s*logical_output: LogicalOutput,\s*\}/.test(s), "the three writes answer the row");
  assert.ok(/struct ListLogicalOutputsResponse \{\s*v: u32,\s*logical_outputs: Vec<LogicalOutput>,\s*\}/.test(s), "the list answers every row");
  for (const verb of Object.values(LOGICAL_OUTPUT_VERBS)) {
    assert.ok(s.includes(`"${verb}"`), verb + " is declared");
  }
});
