// Contract (G3, zone EQ): the operator can store an EQ on a zone. The
// controls sit on the zone being edited inside ZoneList; EqPanel stays the
// global EQ on the Processing stage. decodeZone keeps eq - a zone answer
// without eq, or with a band list that is not exactly 10, is left out.
// zone.set_eq_engaged sends { id, engaged }; zone.set_eq_band sends
// { id, index, freq_hz, gain_db, q }; both ride the existing zoneVerb on
// audio.zones (the hook adds v) and the answer replaces that zone by id.
// An unchanged flag or band sends nothing; an index outside 0..9, freq_hz
// outside 20..20000, gain_db outside -15..15, q outside 0.1..30 sends
// nothing. A band writes on release. Turning a zone's EQ on does not
// select eq_only and does not call the global EQ verbs. Nothing here
// says the zone EQ is playing.
// Run:
//   node --experimental-strip-types --test tests/contracts/audio-zone-eq.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ZONE_EQ_BAND_COUNT,
  ZONE_VERBS,
  decodeZone,
  flatZoneEq,
  zoneEqBandPayload,
  zoneEqEngagedPayload
} from "../../src/features/audio/zone-verbs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "src");
const hook = readFileSync(join(root, "features", "audio", "useAudioOptions.ts"), "utf8");
const list = readFileSync(join(root, "features", "audio", "ZoneList.tsx"), "utf8");
const eqPanel = readFileSync(join(root, "features", "audio", "EqPanel.tsx"), "utf8");
const helper = readFileSync(join(root, "features", "audio", "zone-verbs.ts"), "utf8");
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

const flat = { freqHz: 1000, gainDb: 0, q: 1 };
const wireFlat = { freq_hz: 1000, gain_db: 0, q: 1 };
const hall = { id: "zone:1", name: "Hall", logicalOutputIds: ["logical:1"], eq: flatZoneEq() };

test("the two verbs, on the zones shelf; the engage payload is { id, engaged } and sends nothing when the flag does not change", () => {
  assert.equal(ZONE_VERBS.setEqEngaged, "zone.set_eq_engaged");
  assert.equal(ZONE_VERBS.setEqBand, "zone.set_eq_band");
  assert.deepEqual(zoneEqEngagedPayload(hall, true), { id: "zone:1", engaged: true });
  assert.deepEqual(Object.keys(zoneEqEngagedPayload(hall, true) ?? {}), ["id", "engaged"]);
  assert.equal(zoneEqEngagedPayload(hall, false), null, "the flag already off: nothing sent");
  assert.equal(zoneEqEngagedPayload({ ...hall, eq: { ...hall.eq, engaged: true } }, true), null);
  assert.ok(!/options\.|set_eq_engaged"|set_eq_band"|select_mode|eq_only|DELIVERY|audio\.delivery/.test(code(helper).replace(/"zone\.set_eq_(engaged|band)"/g, "")), "the helper names no global EQ verb, no composition mode, no delivery shelf");
});

test("the band payload is { id, index, freq_hz, gain_db, q }; unchanged or out of range sends nothing", () => {
  const p = zoneEqBandPayload(hall, 3, { freqHz: 250, gainDb: -2.5, q: 1.4 });
  assert.deepEqual(p, { id: "zone:1", index: 3, freq_hz: 250, gain_db: -2.5, q: 1.4 });
  assert.deepEqual(Object.keys(p ?? {}), ["id", "index", "freq_hz", "gain_db", "q"]);
  assert.equal(zoneEqBandPayload(hall, 3, flat), null, "the band as it is: nothing sent");
  assert.equal(zoneEqBandPayload(hall, -1, { freqHz: 250, gainDb: 0, q: 1 }), null, "index below 0");
  assert.equal(zoneEqBandPayload(hall, 10, { freqHz: 250, gainDb: 0, q: 1 }), null, "index above 9");
  assert.equal(zoneEqBandPayload(hall, 2.5, { freqHz: 250, gainDb: 0, q: 1 }), null, "a whole index only");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 19, gainDb: 0, q: 1 }), null, "freq_hz below 20");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 20001, gainDb: 0, q: 1 }), null, "freq_hz above 20000");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 250, gainDb: -15.5, q: 1 }), null, "gain_db below -15");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 250, gainDb: 15.5, q: 1 }), null, "gain_db above 15");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 250, gainDb: 0, q: 0.05 }), null, "q below 0.1");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: 250, gainDb: 0, q: 30.5 }), null, "q above 30");
  assert.equal(zoneEqBandPayload(hall, 0, { freqHz: Number.NaN, gainDb: 0, q: 1 }), null);
  assert.deepEqual(zoneEqBandPayload(hall, 9, { freqHz: 20, gainDb: -15, q: 0.1 }), { id: "zone:1", index: 9, freq_hz: 20, gain_db: -15, q: 0.1 }, "the edges are inside");
  assert.deepEqual(zoneEqBandPayload(hall, 0, { freqHz: 20000, gainDb: 15, q: 30 }), { id: "zone:1", index: 0, freq_hz: 20000, gain_db: 15, q: 30 });
});

test("decodeZone keeps eq; a zone without eq, or with a band list that is not exactly 10, is left out", () => {
  assert.equal(ZONE_EQ_BAND_COUNT, 10);
  const bands = Array.from({ length: 10 }, () => ({ ...wireFlat }));
  const z = decodeZone({ id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: { engaged: true, bands } });
  assert.ok(z !== null);
  assert.equal(z.eq.engaged, true);
  assert.equal(z.eq.bands.length, 10);
  assert.deepEqual(z.eq.bands[0], flat);
  assert.equal(decodeZone({ id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"] }), null, "no eq, no zone");
  assert.equal(decodeZone({ id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: { engaged: false, bands: bands.slice(0, 9) } }), null, "nine bands, no zone");
  assert.equal(decodeZone({ id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: { engaged: false, bands: [...bands, { ...wireFlat }] } }), null, "eleven bands, no zone");
  assert.equal(decodeZone({ id: "zone:1", name: "Hall", logical_output_ids: ["logical:1"], eq: { engaged: false, bands: [...bands.slice(0, 9), { freq_hz: "x", gain_db: 0, q: 1 }] } }), null, "a band that is not a band, no zone");
  assert.deepEqual(flatZoneEq(), { engaged: false, bands: Array.from({ length: 10 }, () => ({ ...flat })) });
});

test("the hook: both verbs ride the existing zoneVerb on audio.zones; the answer replaces that zone by id; the write-socket count stays 11", () => {
  assert.ok(/const setZoneEqEngaged = useCallback\(\s*\(payload: ZoneEqEngagedPayload\) => zoneVerb\(ZONE_VERBS\.setEqEngaged, payload, withZoneUpdated\)/.test(hook));
  assert.ok(/const setZoneEqBand = useCallback\(\s*\(payload: ZoneEqBandPayload\) => zoneVerb\(ZONE_VERBS\.setEqBand, payload, withZoneUpdated\)/.test(hook));
  const block = between(hook, "const zoneVerb = useCallback(", "\n  );");
  assert.equal((block.match(/await writeRequest\(/g) ?? []).length, 1);
  assert.ok(/await writeRequest\(ZONES_SHELF, requestType, \{/.test(block), "audio.zones");
  assert.ok(!/DELIVERY_SHELF|OPTIONS_SHELF|readZones|refreshSettings/.test(block), "never audio.delivery, never audio.options, no second list, no options re-read");
  // Scene lift (named, accepted with that row): the twelfth site is
  // sceneVerb on audio.zones; the zone EQ verbs still add none.
  // Sleep timer lift (named, accepted with that row): the thirteenth site
  // is setSleepTimer on audio.options; the zone EQ verbs still add none.
  // Alarm lift (named, accepted with that row): the fourteenth site is
  // alarmVerb on audio.alarm; the zone EQ verbs still add none.
  assert.equal((code(hook).match(/await writeRequest\(/g) ?? []).length, 14, "no write site for the zone EQ verbs: the twelfth is sceneVerb, the thirteenth setSleepTimer, the fourteenth alarmVerb");
  assert.equal((code(hook).match(/"zone\.set_eq_(engaged|band)"/g) ?? []).length, 0, "the verbs are named once, in the helper");
  assert.ok(/zoneVerb \(the three zone verbs and the two zone EQ verbs, audio\.zones\)/.test(socketPin), "the write-socket assertion names the EQ verbs on the zoneVerb site");
  assert.ok(/length, 14,/.test(socketPin), "the count is the write-socket pin's: 14 with sceneVerb, setSleepTimer and alarmVerb");
});

test("the controls sit on the zone being edited; a band writes on release; an engage goes through the helper; nothing reaches the global EQ", () => {
  const l = code(list);
  // The markers are JSX comments, so the structural slices read the raw file.
  const eq = between(list, 'className="audio-zone-eq"', "{/* end audio-zone-eq */}");
  assert.ok(/onEqEngaged\(zone, /.test(eq) && /onEqBand\(zone, index, /.test(eq), "the controls hand the zone as listed to the two handlers");
  assert.ok(/const payload = zoneEqEngagedPayload\(zone, engaged\);/.test(l) && /const payload = zoneEqBandPayload\(zone, index, band\);/.test(l), "payloads come from the helper, against the zone as listed");
  assert.ok(/props\.onSetEqEngaged\(/.test(l) && /props\.onSetEqBand\(/.test(l));
  assert.ok(/if \(payload === null\) return;/.test(between(l, "const onEqEngaged = async", "\n  };")), "an unchanged flag sends nothing");
  assert.ok(/if \(payload === null\) return;/.test(between(l, "const onEqBand = async", "\n  };")), "an unchanged or out-of-range band sends nothing");
  assert.ok(/type="number"/.test(eq), "the band fields are typed numbers");
  assert.ok(/field\("freqHz"/.test(eq) && /field\("gainDb"/.test(eq) && /field\("q"/.test(eq), "freq_hz, gain_db and q on every band");
  assert.ok(/zone\.eq\.bands\.map\(\(band, index\)/.test(eq), "the ten bands the answer carries");
  assert.ok(!/onInput=/.test(eq), "a band writes on release, not on each pixel");
  assert.ok(/onChange=/.test(eq));
  assert.ok(/editingId === zone\.id \?/.test(list), "the EQ sits inside the edit branch");
  assert.ok(list.indexOf('className="audio-zone-eq"') > list.indexOf("editingId === zone.id ?") && list.indexOf('className="audio-zone-eq"') < list.indexOf(") : (\n              <li key={zone.id}"), "inside the zone being edited");
  assert.ok(!/options\.|set_eq_engaged"|set_eq_band"|selectEqMode|select_mode|eq_only|EqPanel|setEqBand\(|setEqEngaged\(/.test(l), "no global EQ verb, no composition mode, no EqPanel");
  assert.ok(!/zone|Zone/.test(code(eqPanel)), "EqPanel gains no zone verb");
});

test("the strings exist, are ASCII, and do not say the zone EQ is playing", () => {
  for (const key of ["audioopt.zoneEq", "audioopt.zoneEqOn", "audioopt.zoneEqBand", "audioopt.zoneEqFreq", "audioopt.zoneEqGain", "audioopt.zoneEqQ", "audioopt.zoneEqStoredNote"]) {
    const m = en.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":\\s*"([^"]*)"'));
    assert.ok(m !== null, key + " is in the catalogue");
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), key + " is 7-bit ASCII");
    assert.ok(!/playing|applied|live|hear/i.test(m[1]), key + " does not say the zone EQ is playing");
  }
});

// ---- the plugin side, when its checkout is beside this one --------------

test("the plugin's EQ requests read v + id + engaged and v + id + index + freq_hz + gain_db + q; the zone carries eq; both verbs are on the zones stocking", (t) => {
  const rs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "lib.rs");
  const zs = join(here, "..", "..", "..", "..", "..", "evo-device-audio", "plugins", "org.evoframework.delivery.alsa", "src", "zones.rs");
  if (!existsSync(rs) || !existsSync(zs)) {
    t.skip("plugin checkout not beside this tree");
    return;
  }
  const s = readFileSync(rs, "utf8");
  const z = readFileSync(zs, "utf8");
  const eng = between(s, "struct ZoneSetEqEngagedRequest {", "\n}");
  assert.ok(/\bid: String/.test(eng) && /engaged: bool/.test(eng));
  const band = between(s, "struct ZoneSetEqBandRequest {", "\n}");
  for (const f of ["id: String", "index: u32", "freq_hz: u32", "gain_db: f32", "q: f32"]) assert.ok(band.includes(f), f);
  assert.ok(/pub\(crate\) const EQ_BAND_COUNT: usize = 10;/.test(z));
  assert.ok(/EQ_BAND_FREQ_MIN: u32 = 20;/.test(z) && /EQ_BAND_FREQ_MAX: u32 = 20_000;/.test(z) && /EQ_BAND_GAIN_MIN_DB: f32 = -15\.0;/.test(z) && /EQ_BAND_GAIN_MAX_DB: f32 = 15\.0;/.test(z) && /EQ_BAND_Q_MIN: f32 = 0\.1;/.test(z) && /EQ_BAND_Q_MAX: f32 = 30\.0;/.test(z), "the same ranges");
  assert.ok(/pub\(crate\) eq: ZoneEq,/.test(z), "the zone carries eq");
  assert.ok(s.includes('"zone.set_eq_engaged"') && s.includes('"zone.set_eq_band"'));
});
