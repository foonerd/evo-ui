// Contract (G1): each listed output can be enabled, silenced, and given its
// own volume. On each output the audio options list already shows, five
// controls, one verb each, with that row's hw:N,M id and nothing else:
// delivery.enable_output, delivery.disable_output,
// delivery.set_output_volume (volume 0..100), delivery.play_output,
// delivery.pause_output. The answer paints that output only (enabled,
// playing, volume); a refusal is shown and the other outputs stay as they
// were. Play is not options.set_output_device; volume is not the global
// volume. The output picker and the global volume stay where they are.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-output-controls.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OUTPUT_VERBS,
  decodeOutputState,
  outputPayload,
  outputVolumePayload
} from "../../src/features/audio/output-verbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const panel = readFileSync(join(root, "features", "audio", "AudioOptionsPanel.tsx"), "utf8");
const row = readFileSync(join(root, "features", "audio", "OutputControlRow.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "output-verbs.ts"), "utf8");
const en = readFileSync(join(root, "locales", "en.ts"), "utf8");

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, "missing " + start);
  const b = src.indexOf(end, a);
  assert.ok(b > a, "missing " + end);
  return src.slice(a, b);
}

const code = (s: string): string => s.replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("five verbs, each with output_id and nothing else; volume adds volume 0..100 and nothing above", () => {
  assert.deepEqual(OUTPUT_VERBS, {
    enable: "delivery.enable_output",
    disable: "delivery.disable_output",
    volume: "delivery.set_output_volume",
    play: "delivery.play_output",
    pause: "delivery.pause_output"
  });
  assert.deepEqual(outputPayload("hw:1,0"), { output_id: "hw:1,0" });
  assert.deepEqual(Object.keys(outputPayload("hw:1,0")), ["output_id"]);
  assert.deepEqual(outputVolumePayload("hw:1,0", 0), { output_id: "hw:1,0", volume: 0 });
  assert.deepEqual(outputVolumePayload("hw:1,0", 100), { output_id: "hw:1,0", volume: 100 });
  assert.deepEqual(Object.keys(outputVolumePayload("hw:1,0", 50) ?? {}), ["output_id", "volume"]);
  assert.equal(outputVolumePayload("hw:1,0", 101), null, "volume cannot be sent above 100");
  assert.equal(outputVolumePayload("hw:1,0", -1), null);
  assert.equal(outputVolumePayload("hw:1,0", 50.5), null, "whole numbers only");
  assert.equal(outputVolumePayload("hw:1,0", Number.NaN), null);
  assert.equal(outputPayload("hw:1,0").output_id, "hw:1,0");
  for (const key of ["device", "value", "mode", "target", "verb"]) {
    assert.ok(!(key in outputPayload("hw:1,0")), key + " is never sent");
  }
  assert.ok(!/set_output_device|set_volume\b|set_startup_volume|set_max_volume|options\./.test(code(helper)), "the helper names no picker verb and no global volume verb");
});

test("the answer decodes to that output's enabled, playing, volume", () => {
  assert.deepEqual(
    decodeOutputState({ v: 1, output: { output_id: "hw:1,0", enabled: true, playing: false, volume: 40 } }),
    { outputId: "hw:1,0", enabled: true, playing: false, volume: 40 }
  );
  assert.deepEqual(
    decodeOutputState({ v: 1, output: { output_id: "hw:0,0", enabled: false, playing: false, volume: null } }),
    { outputId: "hw:0,0", enabled: false, playing: false, volume: null }
  );
  assert.equal(decodeOutputState({ v: 1, output: { enabled: true } }), null, "no id is not an answer");
  assert.equal(decodeOutputState({ v: 1 }), null);
  assert.equal(decodeOutputState(null), null);
});

test("the hook: one write site on the delivery shelf, five callers, each the one verb with that id", () => {
  const block = between(hook, "const outputVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1, "one write site for the five verbs");
  assert.ok(/await writeRequest\(DELIVERY_SHELF, requestType, \{\s*v: PAYLOAD_VERSION,\s*\.\.\.payload\s*\}\)/.test(block), "the delivery shelf, the versioned envelope, the helper's payload");
  assert.ok(/decodeOutputState\(result\.value\)/.test(block), "the answer is decoded, not trusted");
  assert.ok(!/refreshSettings|set_output_device|OPTIONS_SHELF/.test(block), "no re-read of the options, no picker verb");
  assert.ok(/const enableOutput = useCallback\(\s*\(outputId: string\) => outputVerb\(OUTPUT_VERBS\.enable, outputPayload\(outputId\)\)/.test(hook));
  assert.ok(/const disableOutput = useCallback\(\s*\(outputId: string\) => outputVerb\(OUTPUT_VERBS\.disable, outputPayload\(outputId\)\)/.test(hook));
  assert.ok(/const playOutput = useCallback\(\s*\(outputId: string\) => outputVerb\(OUTPUT_VERBS\.play, outputPayload\(outputId\)\)/.test(hook));
  assert.ok(/const pauseOutput = useCallback\(\s*\(outputId: string\) => outputVerb\(OUTPUT_VERBS\.pause, outputPayload\(outputId\)\)/.test(hook));
  const vol = between(hook, "const setOutputVolume = useCallback(", "\n  );");
  assert.ok(/const payload = outputVolumePayload\(outputId, volume\);\s*if \(payload === null\)/.test(vol), "an out-of-range volume is refused before any send");
  assert.ok(/outputVerb\(OUTPUT_VERBS\.volume, payload\)/.test(vol));
  assert.equal((code(hook).match(/delivery\.(enable|disable|play|pause)_output|delivery\.set_output_volume/g) ?? []).length, 0, "the verbs are named once, in the helper");
  assert.ok(/options\.set_output_device/.test(hook), "the picker's verb is still the picker's");
});

test("one row per listed output; every control on a row names that row's id and no other", () => {
  const rowCode = code(row);
  const calls = [...rowCode.matchAll(/on(Enable|Disable|Play|Pause|Volume)\(([^)]*)\)/g)];
  assert.ok(calls.length >= 5, "five controls");
  for (const c of calls) {
    assert.ok(c[2].startsWith("output.alsaId"), `${c[0]} names this row's id`);
  }
  assert.ok(!/selectedOutput|outputDevice|setOutputDevice|set_output_device|setVolume\b|startupVolume|maxVolume/.test(rowCode), "a row control is not the picker and not the global volume");
  assert.ok(/max=\{100\}/.test(row) && /min=\{0\}/.test(row), "the slider is 0..100");
  assert.ok(/onChange=/.test(between(row, 'type="range"', "/>")) && !/onInput=/.test(between(row, 'type="range"', "/>")), "one write per gesture - on release, not per pixel");
  assert.ok(/props\.error/.test(row) || /error !== null/.test(row), "a refusal is shown on that row");
  const list = between(panel, 'className="audio-output-rows"', "{/* end audio-output-rows */}");
  assert.ok(/outputsInClass\.map\(\(o\) =>/.test(list), "the outputs the list already shows");
  assert.ok(/<OutputControlRow/.test(list));
  assert.ok(/state=\{outputStates\[o\.alsaId\] \?\? null\}/.test(list) && /error=\{outputErrors\[o\.alsaId\] \?\? null\}/.test(list), "state and refusal are per output");
  assert.ok(/onChange=\{\(v\) => void onPickDevice\(v\)\}/.test(panel), "the picker stays the picker");
});

test("the answer paints that output only; a refusal leaves the others as they were", () => {
  const apply = between(panel, "const runOutputVerb = useCallback(", "}, [");
  assert.ok(/setOutputStates\(\(cur\) => \(\{ \.\.\.cur, \[r\.value\.outputId\]: r\.value \}\)\)/.test(apply), "one output's state, keyed by the answer's id");
  assert.ok(/setOutputErrors\(\(cur\) => \(\{ \.\.\.cur, \[outputId\]: r\.message \}\)\)/.test(apply), "a refusal lands on that row");
  assert.ok(!/setOutputStates\(\{\}\)|setOutputStates\(\(\) =>/.test(apply), "the other outputs are not reset");
  assert.ok(!/setOutputDevice|refreshSettings|onPickDevice/.test(apply), "no picker write rides along");
});

test("the strings exist and are ASCII", () => {
  for (const key of ["audioopt.outputRows", "audioopt.outputEnable", "audioopt.outputDisable", "audioopt.outputPlay", "audioopt.outputPause", "audioopt.outputVolume", "audioopt.outputEnabled", "audioopt.outputDisabled", "audioopt.outputPlaying", "audioopt.outputIdle", "audioopt.outputUnknown"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's output requests read v + output_id (+ volume u8) and answer { v, output }", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "lib.rs");
  if (!existsSync(rs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const req = between(s, "struct OutputRequest {", "\n}");
  assert.ok(/output_id: String/.test(req) && !/volume/.test(req));
  const volReq = between(s, "struct OutputVolumeRequest {", "\n}");
  assert.ok(/output_id: String/.test(volReq) && /volume: u8/.test(volReq));
  assert.ok(/struct OutputResponse \{\s*v: u32,\s*output: OutputSnapshot,\s*\}/.test(s), "the answer is that output's snapshot");
  for (const verb of ["delivery.enable_output", "delivery.disable_output", "delivery.set_output_volume", "delivery.play_output", "delivery.pause_output"]) {
    assert.ok(s.includes(`"${verb}"`), verb + " is declared");
  }
});
