// Contract (G3): the operator can name a zone. A zone is a name over one
// or more logical outputs already on the output stage - not an output,
// not an EQ, not a scene. The list sits under the named outputs. zone.list
// is one read on shelf audio.zones at connect, { v } only. zone.add,
// zone.update and zone.remove go through one zoneVerb write on that same
// shelf; the hook adds v. Add sends { name, logical_output_ids }; update
// sends { id } plus what changed; remove sends { id } only. An empty name
// or an empty membership is never sent; an unchanged zone sends nothing;
// remove asks first and cancel sends nothing. Each membership id is a
// logical:<n> from the named outputs on screen - never a physical hw:N,M,
// and never one another painted zone holds (the zone being edited may
// keep its own). The answer { zone } is applied to the list - append,
// replace by id, drop by id - with no second list and no options re-read.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-zones.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ZONES_SHELF,
  ZONE_VERBS,
  addZonePayload,
  decodeZoneAnswer,
  decodeZoneList,
  flatZoneEq,
  removeZonePayload,
  updateZonePayload,
  withZoneAdded,
  withZoneRemoved,
  withZoneUpdated,
  zoneChoices
} from "../../src/features/audio/zone-verbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const list = readFileSync(join(root, "features", "audio", "ZoneList.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "zone-verbs.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Zone EQ lift (named, accepted with that row): a zone carries eq, and a
// zone answer without it is left out, so the fixtures carry the flat EQ.
const hall = { id: "zone:1", name: "Hall", logicalOutputIds: ["logical:1", "logical:2"], eq: flatZoneEq() };
const study = { id: "zone:2", name: "Study", logicalOutputIds: ["logical:3"], eq: flatZoneEq() };
const wireEq = { engaged: false, bands: Array.from({ length: 10 }, () => ({ freq_hz: 1000, gain_db: 0, q: 1 })) };

test("the shelf and the four verbs; the payloads carry exactly what the order names", () => {
  assert.equal(ZONES_SHELF, "audio.zones");
  // Zone EQ lift (named, accepted with that row): the two EQ verbs join the set.
  assert.deepEqual(ZONE_VERBS, { list: "zone.list", add: "zone.add", update: "zone.update", remove: "zone.remove", setEqEngaged: "zone.set_eq_engaged", setEqBand: "zone.set_eq_band" });
  assert.deepEqual(addZonePayload("  Hall ", ["logical:1", "logical:2"]), { name: "Hall", logical_output_ids: ["logical:1", "logical:2"] });
  assert.deepEqual(Object.keys(addZonePayload("Hall", ["logical:1"]) ?? {}), ["name", "logical_output_ids"]);
  assert.equal(addZonePayload("   ", ["logical:1"]), null, "an empty name is never sent");
  assert.equal(addZonePayload("Hall", []), null, "an empty membership is never sent");
  assert.deepEqual(updateZonePayload(hall, { name: "Hall", logicalOutputIds: ["logical:1", "logical:2"] }), null, "nothing changed, nothing sent");
  assert.deepEqual(updateZonePayload(hall, { name: "Hall", logicalOutputIds: ["logical:2", "logical:1"] }), null, "the same membership in another order is no change");
  assert.deepEqual(updateZonePayload(hall, { name: "Great Hall", logicalOutputIds: ["logical:1", "logical:2"] }), { id: "zone:1", name: "Great Hall" });
  assert.deepEqual(updateZonePayload(hall, { name: "Hall", logicalOutputIds: ["logical:1"] }), { id: "zone:1", logical_output_ids: ["logical:1"] });
  assert.deepEqual(updateZonePayload(hall, { name: "Great Hall", logicalOutputIds: ["logical:1"] }), { id: "zone:1", name: "Great Hall", logical_output_ids: ["logical:1"] });
  assert.equal(updateZonePayload(hall, { name: " ", logicalOutputIds: ["logical:1"] }), null, "an empty name is never sent");
  assert.equal(updateZonePayload(hall, { name: "Hall", logicalOutputIds: [] }), null, "an empty membership is never sent");
  assert.deepEqual(removeZonePayload("zone:1"), { id: "zone:1" });
  assert.deepEqual(Object.keys(removeZonePayload("zone:1")), ["id"]);
  // Zone EQ lift (named, accepted with that row): the helper now carries the
  // zone's own EQ; what it must still never name is the global EQ on
  // audio.options and a composition mode.
  assert.ok(!/audio\.delivery|DELIVERY_SHELF|logical_output\b|hw:|set_output_device|OUTPUT_VERBS|options\.|"set_eq_band"|"set_eq_engaged"|select_mode|eq_only|\bscene\b/i.test(code(helper).replace(/logical_output_ids|logicalOutputIds|logicalOutputs|LogicalOutput/g, "")), "the helper names no delivery verb, no physical id, no global EQ, no composition mode, no scene");
});

test("the answers decode: one zone, the list in the answer's order; the list becomes the answer", () => {
  assert.deepEqual(decodeZoneAnswer({ v: 1, zone: { id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: wireEq } }), { id: "zone:1", name: "Hall", logicalOutputIds: ["logical:1"], eq: flatZoneEq() });
  assert.equal(decodeZoneAnswer({ v: 1, zone: { id: "zone:1", name: "Hall", eq: wireEq } }), null, "no membership is not a zone");
  assert.equal(decodeZoneAnswer({ v: 1 }), null);
  assert.deepEqual(decodeZoneList({ v: 1, zones: [
    { id: "zone:2", name: "Study", logical_output_ids: ["logical:3"], eq: wireEq },
    { id: "zone:1", name: "Hall", logical_output_ids: ["logical:1", "logical:2"], eq: wireEq },
    { id: "zone:9" }
  ] }).map((z) => z.id), ["zone:2", "zone:1"], "the answer's order, unusable rows left out");
  assert.deepEqual(decodeZoneList({ v: 1 }), []);
  assert.ok(!/\.sort\(/.test(code(helper).replace(/\[\.\.\.a\]\.sort\(\)|\[\.\.\.b\]\.sort\(\)/g, "")), "the list is never reordered");
  assert.deepEqual(withZoneAdded([hall], study), [hall, study]);
  assert.deepEqual(withZoneUpdated([hall, study], { ...hall, name: "Great Hall" }).map((z) => z.name), ["Great Hall", "Study"]);
  assert.deepEqual(withZoneRemoved([hall, study], hall), [study]);
});

test("the choices: logical ids from the named outputs on screen, never a physical id, never one another zone holds", () => {
  const named = [
    { id: "logical:1", name: "Left", outputId: "hw:0,0" },
    { id: "logical:2", name: "Right", outputId: "hw:0,0" },
    { id: "logical:3", name: "Desk", outputId: "hw:1,0" },
    { id: "logical:4", name: "Spare", outputId: "hw:2,0" }
  ];
  assert.deepEqual(zoneChoices(named, [hall, study], null).map((c) => c.id), ["logical:4"], "adding: only what no zone holds");
  assert.deepEqual(zoneChoices(named, [hall, study], "zone:1").map((c) => c.id), ["logical:1", "logical:2", "logical:4"], "editing Hall: its own, plus the free ones; not Study's");
  assert.ok(zoneChoices(named, [hall, study], "zone:1").every((c) => c.id.startsWith("logical:")), "never a physical id");
  assert.deepEqual(zoneChoices([], [hall], null), [], "no named outputs on screen, nothing to choose");
});

test("the hook: zone.list is one read on audio.zones at connect, { v } only; zoneVerb is one write site on audio.zones; the answer becomes the list", () => {
  assert.ok(/const ZONES_SHELF = "audio\.zones";/.test(hook) || /ZONES_SHELF/.test(hook), "the zones shelf is named");
  const read = between(hook, "const readZones = useCallback(", "\n  );");
  assert.ok(/pluginRequest\(\s*transport,\s*ZONES_SHELF,\s*ZONE_VERBS\.list,\s*\{ v: PAYLOAD_VERSION \}\s*\)/.test(read), "audio.zones, zone.list, { v } and nothing else");
  assert.ok(/setZones\(decodeZoneList\(result\.value\)\)/.test(read));
  assert.equal((code(hook).match(/ZONE_VERBS\.list/g) ?? []).length, 1, "the list verb is sent from one place");
  const seed = between(hook, "const seed = async (): Promise<void> => {", "// Happening handler");
  assert.ok(/await readLogicalOutputs\(transport\);\s*if \(cancelled\) return;\s*await readZones\(transport\);/.test(seed), "read at connect, after the named outputs");
  assert.equal((code(hook).match(/readZones\(/g) ?? []).length, 1, "no second list anywhere");
  const block = between(hook, "const zoneVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1, "one write site for the three verbs");
  assert.ok(/await writeRequest\(ZONES_SHELF, requestType, \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "audio.zones, the versioned envelope, the helper's payload");
  assert.ok(!/DELIVERY_SHELF/.test(block), "a zone verb is never sent on audio.delivery");
  assert.ok(/decodeZoneAnswer\(result\.value\)/.test(block), "the answer is decoded, not trusted");
  assert.ok(/setZones\(\(cur\) => apply\(cur, zone\)\)/.test(block), "the list becomes the answer");
  assert.ok(!/readZones|readLogicalOutputs|refreshSettings|refreshOutputDevices|OPTIONS_SHELF|OUTPUT_VERBS\.|LOGICAL_OUTPUT_VERBS\./.test(block), "no second list, no options re-read, no delivery verb");
  assert.ok(/const addZone = useCallback\(\s*\(payload: AddZonePayload\) => zoneVerb\(ZONE_VERBS\.add, payload, withZoneAdded\)/.test(hook));
  assert.ok(/const updateZone = useCallback\(\s*\(payload: UpdateZonePayload\) => zoneVerb\(ZONE_VERBS\.update, payload, withZoneUpdated\)/.test(hook));
  assert.ok(/const removeZone = useCallback\(\s*\(payload: RemoveZonePayload\) => zoneVerb\(ZONE_VERBS\.remove, payload, withZoneRemoved\)/.test(hook));
  assert.equal((code(hook).match(/"zone\.(list|add|update|remove)"/g) ?? []).length, 0, "the verbs are named once, in the helper");
  assert.ok(hook.indexOf("const zoneVerb = useCallback(") < hook.indexOf("const listEqPresets = useCallback("), "zoneVerb sits before listEqPresets, clear of the test-tone slice");
  assert.ok(/delivery\.remove_logical_output|LOGICAL_OUTPUT_VERBS\.remove/.test(hook), "the one logical-output remove stays where it was");
});

test("the list: zones in the answer's order; add, update and remove through the helper's payloads; cancel sends nothing; no physical choice", () => {
  const l = code(list);
  assert.ok(/rows\.length === 0/.test(l) && /rows\.map\(\(zone\) =>/.test(l), "the zones as answered, or the empty line");
  assert.ok(!/\.sort\(/.test(l), "the glass does not reorder the answer");
  assert.ok(/const payload = addZonePayload\(addName, addMembers\);\s*if \(payload === null\) return;/.test(l), "add refuses an empty name or an empty membership before any send");
  assert.ok(/await props\.onAdd\(payload\)/.test(l));
  assert.ok(/const payload = updateZonePayload\(zone, \{ name: editName, logicalOutputIds: editMembers \}\);\s*if \(payload === null\) return;/.test(l), "an unchanged zone sends nothing");
  assert.ok(/await props\.onUpdate\(payload\)/.test(l));
  assert.ok(/const payload = removeZonePayload\(removeAsk\.id\);/.test(l) && /await props\.onRemove\(payload\)/.test(l), "remove sends the asked zone's id");
  assert.ok(/<ConfirmDialog/.test(l), "remove asks first");
  assert.ok(/onCancel=\{\(\) => setRemoveAsk\(null\)\}/.test(l), "cancel closes the ask and sends nothing");
  assert.ok(/zoneChoices\(logicalOutputs, rows, null\)/.test(l) && /zoneChoices\(logicalOutputs, rows, zone\.id\)/.test(l), "choices come from the named outputs on screen, less what other zones hold");
  assert.ok(!/alsaId|hw:|AlsaOutput|outputsInClass|alsaOutputs/.test(l), "a zone row never sees a physical id");
  // Zone EQ lift (named, accepted with that row): the list carries the zone's
  // own EQ controls; what it must still never reach is the global EQ.
  assert.ok(!/onEnable|onDisable|onPlay|onPause|onVolume|type="range"|OUTPUT_VERBS|LOGICAL_OUTPUT_VERBS|set_output_device|onPickDevice|setOutputDevice|EqPanel|\bsetEqBand\(|\bsetEqEngaged\(|options\.|"set_eq_band"|"set_eq_engaged"|select_mode|eq_only|recall_eq|\bscene\b/.test(l), "no physical control, no named-output verb, no picker, no global EQ, no composition mode, no scene");
  assert.ok(/type="checkbox"/.test(l), "membership is picked, not typed");
});

test("the stage: the zone list sits under the named outputs; the named list, the physical rows and the picker are as they were", () => {
  const zones = between(panel, "{/* end audio-named-outputs */}", "{/* end audio-zones */}");
  assert.ok(/<ZoneList/.test(zones));
  assert.ok(/rows=\{zones\}/.test(zones) && /logicalOutputs=\{logicalOutputs\}/.test(zones), "the zones, and the named outputs on screen");
  assert.ok(/onAdd=\{addZone\}/.test(zones) && /onUpdate=\{updateZone\}/.test(zones) && /onRemove=\{removeZone\}/.test(zones));
  assert.ok(!/outputsInClass|alsaOutputs/.test(zones), "no physical list reaches the zones");
  const named = between(panel, "{/* end audio-output-rows */}", "{/* end audio-named-outputs */}");
  assert.ok(/<LogicalOutputList/.test(named) && /onRemove=\{removeLogicalOutput\}/.test(named), "the named list is as it was");
  assert.ok(!/Zone/.test(named), "no zone reaches the named list");
  assert.ok(/onChange=\{\(v\) => void onPickDevice\(v\)\}/.test(panel), "the picker stays the picker");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["audioopt.zones", "audioopt.zonesEmpty", "audioopt.zoneName", "audioopt.zoneNamePlaceholder", "audioopt.zoneMembers", "audioopt.zoneNoChoices", "audioopt.zoneAdd", "audioopt.zoneUpdate", "audioopt.zoneSave", "audioopt.zoneRemove", "audioopt.zoneRemoveTitle", "audioopt.zoneRemoveAsk", "audioopt.zoneNotListed"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's zone requests read v + name + logical_output_ids, v + id (+ name, logical_output_ids), v + id; answer { v, zone } and { v, zones }; the four verbs are the audio.zones stocking", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "lib.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const add = between(s, "struct ZoneAddRequest {", "\n}");
  assert.ok(/name: String/.test(add) && /logical_output_ids: Vec<String>/.test(add) && !/\bid: String/.test(add));
  const upd = between(s, "struct ZoneUpdateRequest {", "\n}");
  assert.ok(/\bid: String/.test(upd) && /name: Option<String>/.test(upd) && /logical_output_ids: Option<Vec<String>>/.test(upd));
  const rem = between(s, "struct ZoneRemoveRequest {", "\n}");
  assert.ok(/\bid: String/.test(rem) && !/name|logical_output_ids/.test(rem));
  assert.ok(/struct ZoneResponse \{\s*v: u32,\s*zone: Zone,\s*\}/.test(s));
  assert.ok(/struct ZoneListResponse \{\s*v: u32,\s*zones: Vec<Zone>,\s*\}/.test(s));
  // Zone EQ lift (named, accepted with that row): the stocking carries six.
  // Scene lift (named, accepted with that row): the four scene verbs follow
  // them on the same stocking.
  assert.ok(/"zone\.add",\s*"zone\.update",\s*"zone\.remove",\s*"zone\.list",\s*"zone\.set_eq_engaged",\s*"zone\.set_eq_band",\s*"scene\.save",\s*"scene\.list",\s*"scene\.recall",\s*"scene\.remove",?\s*\]/.test(s), "the four zone verbs, the two EQ verbs and the four scene verbs are the audio.zones stocking");
});
