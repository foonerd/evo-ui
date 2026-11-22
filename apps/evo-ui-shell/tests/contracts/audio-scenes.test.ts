// Contract (G3, scenes): the operator can save and recall a scene. A scene
// is a name and a snapshot of every zone; it does not play. The controls
// sit under the zone list, in the zone section; EqPanel stays the global
// EQ. scene.list is one read on shelf audio.zones at connect, after
// zone.list, { v } only; the names stay in the answer's order and an empty
// answer is an empty list. scene.save, scene.recall and scene.remove go
// through one sceneVerb write on audio.zones (the hook adds v), each with
// { name }; an empty trimmed name sends nothing. A save of a name already
// listed, without regard to case, replaces it in place with the answer's
// spelling; a new name is appended. Remove and recall ask first; cancel
// sends nothing. Save and remove leave the painted zones; recall sets them
// to the answered scene's zones in that order without reading zone.list
// again. A scene answer whose zones do not all decode is a refusal and the
// painted zones stay. A refusal paints under the scene list.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-scenes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SCENE_VERBS,
  decodeSceneAnswer,
  decodeSceneList,
  sceneNamePayload,
  withSceneRecalled,
  withSceneRemoved,
  withSceneSaved
} from "../../src/features/audio/scene-verbs.ts";
import { flatZoneEq } from "../../src/features/audio/zone-verbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const list = readFileSync(join(root, "features", "audio", "SceneList.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "scene-verbs.ts"), "utf8");
const eqPanel = readFileSync(join(root, "features", "audio", "EqPanel.tsx"), "utf8");
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

const wireEq = { engaged: false, bands: Array.from({ length: 10 }, () => ({ freq_hz: 1000, gain_db: 0, q: 1 })) };
const wireHall = { id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: wireEq };
const wireStudy = { id: "zone:4", name: "Study", logical_output_ids: ["logical:2", "logical:3"], eq: wireEq };

test("the four verbs; every write payload is { name } trimmed; an empty trimmed name sends nothing", () => {
  assert.deepEqual(SCENE_VERBS, { list: "scene.list", save: "scene.save", recall: "scene.recall", remove: "scene.remove" });
  assert.deepEqual(sceneNamePayload("  Evening "), { name: "Evening" });
  assert.deepEqual(Object.keys(sceneNamePayload("Evening") ?? {}), ["name"]);
  assert.equal(sceneNamePayload(""), null);
  assert.equal(sceneNamePayload("   "), null, "spaces only is empty");
  assert.ok(!/audio\.delivery|DELIVERY_SHELF|audio\.options|OPTIONS_SHELF|options\.|"set_eq_band"|"set_eq_engaged"|select_mode|eq_only|"zone\.list"/.test(code(helper)), "the helper names no delivery or options shelf, no global EQ, and never zone.list");
});

test("the list decodes in the answer's order; an empty answer is an empty list", () => {
  assert.deepEqual(decodeSceneList({ v: 1, scenes: ["Night", "evening", "Morning"] }), ["Night", "evening", "Morning"], "the answer's order, untouched");
  assert.deepEqual(decodeSceneList({ v: 1, scenes: [] }), []);
  assert.deepEqual(decodeSceneList({ v: 1 }), []);
  assert.deepEqual(decodeSceneList({ v: 1, scenes: ["A", 3, "", "B"] }), ["A", "B"], "only names");
  assert.ok(!/\.sort\(/.test(code(helper)), "never reordered");
});

test("a scene answer decodes only when every zone decodes; otherwise it is a refusal", () => {
  const s = decodeSceneAnswer({ v: 1, scene: { name: "Evening", zones: [wireStudy, wireHall] } });
  assert.ok(s !== null);
  assert.equal(s.name, "Evening");
  assert.deepEqual(s.zones.map((z) => z.id), ["zone:4", "zone:1"], "the snapshot's order");
  assert.deepEqual(s.zones[1]?.eq, flatZoneEq());
  assert.deepEqual(decodeSceneAnswer({ v: 1, scene: { name: "Empty", zones: [] } })?.zones, [], "an empty snapshot is a scene");
  assert.equal(decodeSceneAnswer({ v: 1, scene: { name: "Bad", zones: [wireHall, { id: "zone:2", name: "NoEq", logical_output_ids: ["logical:9"] }] } }), null, "one zone that does not decode: refusal");
  assert.equal(decodeSceneAnswer({ v: 1, scene: { name: "Bad", zones: [wireHall, { ...wireHall, eq: { engaged: true, bands: wireEq.bands.slice(0, 9) } }] } }), null);
  assert.equal(decodeSceneAnswer({ v: 1, scene: { name: "", zones: [] } }), null, "no name, no scene");
  assert.equal(decodeSceneAnswer({ v: 1, scene: { name: "X" } }), null, "no zones list, no scene");
  assert.equal(decodeSceneAnswer({ v: 1 }), null);
});

test("the list after an answer: save replaces in place without regard to case, or appends; remove drops; recall leaves the names", () => {
  const names = ["Night", "evening", "Morning"];
  assert.deepEqual(withSceneSaved(names, { name: "Evening", zones: [] }), ["Night", "Evening", "Morning"], "replaced in place, the answer's spelling");
  assert.deepEqual(withSceneSaved(names, { name: "Late", zones: [] }), ["Night", "evening", "Morning", "Late"], "a new name is appended");
  assert.deepEqual(withSceneRemoved(names, { name: "EVENING", zones: [] }), ["Night", "Morning"], "dropped without regard to case");
  assert.deepEqual(withSceneRemoved(names, { name: "Nope", zones: [] }), names);
  assert.deepEqual(withSceneRecalled(names, { name: "Night", zones: [] }), names);
});

test("the hook: scene.list is one read on audio.zones at connect after zone.list, { v } only; sceneVerb is one write site on audio.zones", () => {
  const read = between(hook, "const readScenes = useCallback(", "\n  );");
  assert.ok(/pluginRequest\(\s*transport,\s*ZONES_SHELF,\s*SCENE_VERBS\.list,\s*\{ v: PAYLOAD_VERSION \}\s*\)/.test(read), "audio.zones, scene.list, { v } and nothing else");
  assert.ok(/setScenes\(decodeSceneList\(result\.value\)\)/.test(read));
  assert.equal((code(hook).match(/SCENE_VERBS\.list/g) ?? []).length, 1, "the list verb is sent from one place");
  assert.equal((code(hook).match(/readScenes\(/g) ?? []).length, 1, "read once");
  const seed = between(hook, "const seed = async (): Promise<void> => {", "// Happening handler");
  assert.ok(/await readZones\(transport\);\s*if \(cancelled\) return;\s*await readScenes\(transport\);/.test(seed), "at connect, after zone.list");
  const block = between(hook, "const sceneVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1, "one write site for the three verbs");
  assert.ok(/await writeRequest\(ZONES_SHELF, requestType, \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "audio.zones, the versioned envelope, { name }");
  assert.ok(!/DELIVERY_SHELF|OPTIONS_SHELF/.test(block), "never audio.delivery, never audio.options");
  assert.ok(/decodeSceneAnswer\(result\.value\)/.test(block), "the answer is decoded, not trusted");
  assert.ok(/if \(scene === null\) \{\s*return \{ ok: false,/.test(block), "a scene whose zones do not all decode is a refusal - before anything is painted");
  assert.ok(/setScenes\(\(cur\) => applyNames\(cur, scene\)\)/.test(block));
  assert.ok(/if \(recall\) setZones\(scene\.zones\);/.test(block), "recall sets the painted zones to the answered scene's zones, in that order");
  assert.ok(!/readZones|readScenes|readLogicalOutputs|refreshSettings|refreshOutputDevices|ZONE_VERBS\.list/.test(block), "recall is not applied by reading the zones again; no options re-read");
  assert.equal((code(hook).match(/readZones\(/g) ?? []).length, 1, "zone.list stays the one zone read");
  assert.ok(/const saveScene = useCallback\(\s*\(payload: SceneNamePayload\) => sceneVerb\(SCENE_VERBS\.save, payload, withSceneSaved, false\)/.test(hook), "save leaves the painted zones");
  assert.ok(/const removeScene = useCallback\(\s*\(payload: SceneNamePayload\) => sceneVerb\(SCENE_VERBS\.remove, payload, withSceneRemoved, false\)/.test(hook), "remove leaves the painted zones");
  assert.ok(/const recallScene = useCallback\(\s*\(payload: SceneNamePayload\) => sceneVerb\(SCENE_VERBS\.recall, payload, withSceneRecalled, true\)/.test(hook), "recall replaces them");
  assert.equal((code(hook).match(/"scene\.(list|save|recall|remove)"/g) ?? []).length, 0, "the verbs are named once, in the helper");
  assert.ok(hook.indexOf("const sceneVerb = useCallback(") < hook.indexOf("const listEqPresets = useCallback("), "sceneVerb sits before listEqPresets, clear of the test-tone slice");
});

test("the write-socket pin: sceneVerb named on audio.zones", () => {
  // Sleep timer lift (named, accepted with that row): the count follows the
  // write-socket pin to 13; sceneVerb stays the named twelfth site.
  // Alarm lift (named, accepted with that row): the count follows to 14.
  assert.equal((code(hook).match(/await writeRequest\(/g) ?? []).length, 14);
  assert.ok(/length, 14,/.test(socketPin), "the count is 14");
  assert.ok(/const sceneVerb = useCallback\\\(\[\\s\\S\]\*\?await writeRequest\\\(ZONES_SHELF, requestType, \\\{/.test(socketPin), "the pin names sceneVerb on audio.zones");
  assert.ok(/sceneVerb \(the three scene verbs, audio\.zones\)/.test(socketPin));
});

test("the scene list: names in the answer's order; save, recall and remove through the helper; recall and remove ask first; cancel sends nothing", () => {
  const l = code(list);
  assert.ok(/rows\.length === 0/.test(l) && /rows\.map\(\(name\) =>/.test(l), "the names as answered, or the empty line");
  assert.ok(!/\.sort\(/.test(l));
  assert.ok(/const payload = sceneNamePayload\(saveName\);\s*if \(payload === null\) return;/.test(l), "an empty name sends nothing");
  assert.ok(/await props\.onSave\(payload\)/.test(l));
  assert.ok(/const payload = sceneNamePayload\(recallAsk\);\s*setRecallAsk\(null\);\s*if \(payload === null\) return;/.test(l) && /await props\.onRecall\(payload\)/.test(l), "recall sends the asked name");
  assert.ok(/const payload = sceneNamePayload\(removeAsk\);\s*setRemoveAsk\(null\);\s*if \(payload === null\) return;/.test(l) && /await props\.onRemove\(payload\)/.test(l), "remove sends the asked name");
  assert.equal((l.match(/<ConfirmDialog/g) ?? []).length, 2, "recall and remove both ask first");
  assert.ok(/onCancel=\{\(\) => setRecallAsk\(null\)\}/.test(l) && /onCancel=\{\(\) => setRemoveAsk\(null\)\}/.test(l), "cancel closes the ask and sends nothing");
  assert.ok(/onClick=\{\(\) => setRecallAsk\(name\)\}/.test(l) && /onClick=\{\(\) => setRemoveAsk\(name\)\}/.test(l), "the row buttons only ask");
  assert.ok(/error !== null/.test(l) && /role="alert"/.test(l), "a refusal paints under the scene list");
  assert.ok(!/EqPanel|options\.|"set_eq_band"|"set_eq_engaged"|select_mode|eq_only|ZONE_VERBS|zone\.list|onPlay|type="range"/.test(l), "no global EQ, no zone verb, no play, no volume");
});

test("the zone section: the scene list sits under the zone list; EqPanel gains no scene verb", () => {
  const scenes = between(panel, "{/* end audio-zones */}", "{/* end audio-scenes */}");
  assert.ok(/<SceneList/.test(scenes));
  assert.ok(/rows=\{scenes\}/.test(scenes) && /onSave=\{saveScene\}/.test(scenes) && /onRecall=\{recallScene\}/.test(scenes) && /onRemove=\{removeScene\}/.test(scenes));
  const zones = between(panel, "{/* end audio-named-outputs */}", "{/* end audio-zones */}");
  assert.ok(/<ZoneList/.test(zones) && !/Scene|scene/.test(zones), "the zone list is as it was");
  assert.ok(!/scene|Scene/.test(code(eqPanel)), "EqPanel gains no scene verb");
});

test("the strings exist, are ASCII, and do not say a scene is playing", () => {
  for (const key of ["audioopt.scenes", "audioopt.scenesEmpty", "audioopt.sceneName", "audioopt.sceneNamePlaceholder", "audioopt.sceneSave", "audioopt.sceneSaveNote", "audioopt.sceneRecall", "audioopt.sceneRecallTitle", "audioopt.sceneRecallAsk", "audioopt.sceneRemove", "audioopt.sceneRemoveTitle", "audioopt.sceneRemoveAsk"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/playing|plays\b|play\b|hear|live\b/i.test(m[1]), key + " does not say a scene is playing");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin reads { v, name } for the three writes, answers { v, scene: { name, zones } } and { v, scenes: [string] }; the four verbs are on the zones stocking", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "lib.rs");
  const ss = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "scenes.rs");
  if (!existsSync(rs) || !existsSync(ss)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const sc = readFileSync(ss, "utf8");
  const req = between(s, "struct SceneNameRequest {", "\n}");
  assert.ok(/\bv: u32/.test(req) && /\bname: String/.test(req) && !/zones|id:/.test(req));
  assert.ok(/struct SceneResponse \{\s*v: u32,\s*scene: Scene,\s*\}/.test(s));
  assert.ok(/struct SceneListResponse \{\s*v: u32,\s*scenes: Vec<String>,\s*\}/.test(s));
  const scene = between(sc, "pub(crate) struct Scene {", "\n}");
  assert.ok(/pub\(crate\) name: String/.test(scene) && /pub\(crate\) zones: Vec<Zone>/.test(scene));
  assert.ok(/\.to_lowercase\(\)/.test(sc), "names match without regard to case");
  for (const verb of Object.values(SCENE_VERBS)) assert.ok(s.includes(`"${verb}"`), verb + " is declared");
});
