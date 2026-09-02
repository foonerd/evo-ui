// Contract tests for the plugin-lifecycle Settings tile decoders.
//
// Each test synthesises the exact wire payload the framework emits -
// the list_plugins response value and the plugin_reload_dispatched
// happening - and asserts the decoded shape, so the tile's behaviour
// is verifiable without a live framework.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePluginInventory,
  decodePluginReloadEvent,
  decodePluginHealth,
  decodePluginDegradedEvent,
  decodePluginRestoredEvent,
  lifecycleModeLabel,
  pluginDegradedReasonMessage,
  pluginReloadOutcomeTone,
  pluginReloadOutcomeMessage,
  shortPluginName,
  type PluginReloadOutcome
} from "../../src/features/system/plugin-lifecycle-decoders.ts";

// --- decodePluginInventory ---------------------------------------

// The exact value shape `list_plugins` emits on a healthy rig.
const LIST_PLUGINS_VALUE = {
  current_seq: 2923,
  plugins_inventory: true,
  plugins: [
    {
      interaction_kind: "warden+respondent",
      name: "org.evoframework.playback.mpd",
      shelf: "audio.playback"
    },
    {
      interaction_kind: "respondent",
      name: "org.evoframework.network",
      shelf: "networking.link"
    }
  ]
};

test("decodePluginInventory decodes the list_plugins response value", () => {
  const out = decodePluginInventory(LIST_PLUGINS_VALUE);
  assert.equal(out.length, 2);
  // Sorted by name: network sorts before playback.mpd.
  assert.equal(out[0].name, "org.evoframework.network");
  assert.equal(out[0].shelf, "networking.link");
  assert.equal(out[0].interactionKind, "respondent");
  assert.equal(out[1].name, "org.evoframework.playback.mpd");
  assert.equal(out[1].interactionKind, "warden+respondent");
});

test("decodePluginInventory accepts a bare array", () => {
  const out = decodePluginInventory([
    { name: "org.evoframework.a", shelf: "s.a", interaction_kind: "respondent" }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "org.evoframework.a");
});

test("decodePluginInventory skips entries with no name and tolerates missing fields", () => {
  const out = decodePluginInventory({
    plugins: [
      { shelf: "s.x", interaction_kind: "respondent" },
      { name: "org.evoframework.b" }
    ]
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "org.evoframework.b");
  assert.equal(out[0].shelf, "");
  assert.equal(out[0].interactionKind, "unknown");
});

test("decodePluginInventory returns [] for non-inventory shapes", () => {
  assert.deepEqual(decodePluginInventory(null), []);
  assert.deepEqual(decodePluginInventory("nope"), []);
  assert.deepEqual(decodePluginInventory({ plugins: "not-an-array" }), []);
});

// --- decodePluginReloadEvent -------------------------------------

// The plugin_reload_dispatched happening: the Happening enum is
// internally tagged on `type`.
function reloadHappening(
  plugin: string,
  outcome: string,
  mode = "reload-cleanable"
): Record<string, unknown> {
  return {
    type: "plugin_reload_dispatched",
    plugin,
    mode,
    outcome,
    source: "operator_gesture",
    at: { secs_since_epoch: 1716400000, nanos_since_epoch: 0 }
  };
}

test("decodePluginReloadEvent decodes a plugin_reload_dispatched happening", () => {
  const ev = decodePluginReloadEvent(
    reloadHappening("org.evoframework.network", "teardown_and_readmit_started")
  );
  assert.notEqual(ev, null);
  assert.equal(ev?.plugin, "org.evoframework.network");
  assert.equal(ev?.outcome, "teardown_and_readmit_started");
  assert.equal(ev?.mode, "reload-cleanable");
  assert.equal(ev?.source, "operator_gesture");
});

test("decodePluginReloadEvent unwraps a { happening: ... } envelope", () => {
  const ev = decodePluginReloadEvent({
    happening: reloadHappening("org.evoframework.a", "refused_frozen", "frozen")
  });
  assert.equal(ev?.plugin, "org.evoframework.a");
  assert.equal(ev?.outcome, "refused_frozen");
});

test("decodePluginReloadEvent maps an unrecognised outcome to unknown", () => {
  const ev = decodePluginReloadEvent(
    reloadHappening("org.evoframework.a", "some_future_outcome")
  );
  assert.equal(ev?.outcome, "unknown");
});

test("decodePluginReloadEvent returns null for a non-reload happening", () => {
  assert.equal(
    decodePluginReloadEvent({ type: "peer_presence_changed", plugin: "x" }),
    null
  );
  assert.equal(decodePluginReloadEvent(null), null);
  assert.equal(decodePluginReloadEvent({ type: "plugin_reload_dispatched" }), null);
});

// --- outcome tone + message --------------------------------------

test("pluginReloadOutcomeTone classifies every outcome", () => {
  assert.equal(pluginReloadOutcomeTone("teardown_and_readmit_started"), "ok");
  assert.equal(pluginReloadOutcomeTone("refused_frozen"), "info");
  assert.equal(pluginReloadOutcomeTone("substrate_driven_acknowledged"), "info");
  assert.equal(pluginReloadOutcomeTone("unknown"), "info");
  assert.equal(pluginReloadOutcomeTone("no_manifest_recorded"), "warn");
  assert.equal(pluginReloadOutcomeTone("plugin_not_admitted"), "warn");
});

test("pluginReloadOutcomeMessage returns a non-empty line for every outcome", () => {
  const outcomes: PluginReloadOutcome[] = [
    "refused_frozen",
    "substrate_driven_acknowledged",
    "teardown_and_readmit_started",
    "no_manifest_recorded",
    "plugin_not_admitted",
    "unknown"
  ];
  for (const o of outcomes) {
    assert.ok(pluginReloadOutcomeMessage(o).length > 0, `message for ${o}`);
  }
});

// --- shortPluginName ---------------------------------------------

test("shortPluginName strips the org.evoframework. prefix", () => {
  assert.equal(
    shortPluginName("org.evoframework.playback.mpd"),
    "playback.mpd"
  );
  assert.equal(shortPluginName("custom.vendor.plugin"), "custom.vendor.plugin");
});

// --- lifecycle_mode on the inventory -----------------------------

test("decodePluginInventory reads lifecycle_mode, defaulting to unknown", () => {
  const out = decodePluginInventory({
    plugins: [
      {
        name: "org.evoframework.a",
        shelf: "s.a",
        interaction_kind: "respondent",
        lifecycle_mode: "reload-cleanable"
      },
      { name: "org.evoframework.b", shelf: "s.b", interaction_kind: "warden" }
    ]
  });
  assert.equal(out[0].lifecycleMode, "reload-cleanable");
  // Missing lifecycle_mode -> unknown.
  assert.equal(out[1].lifecycleMode, "unknown");
});

test("decodePluginInventory rejects an unrecognised lifecycle_mode", () => {
  const out = decodePluginInventory({
    plugins: [
      {
        name: "org.evoframework.a",
        shelf: "s.a",
        interaction_kind: "respondent",
        lifecycle_mode: "made-up-mode"
      }
    ]
  });
  assert.equal(out[0].lifecycleMode, "unknown");
});

test("lifecycleModeLabel labels every mode", () => {
  assert.equal(lifecycleModeLabel("reactive-only"), "Reactive-only");
  assert.equal(lifecycleModeLabel("reload-cleanable"), "Reload-cleanable");
  assert.equal(lifecycleModeLabel("frozen"), "Frozen");
  assert.equal(lifecycleModeLabel("unknown"), "Unknown");
});

// --- decodePluginHealth ------------------------------------------

test("decodePluginHealth decodes a healthy snapshot", () => {
  const h = decodePluginHealth({
    plugin_health: true,
    snapshot: {
      total_admitted: 10,
      degraded: [],
      degraded_count: 0,
      failing: []
    }
  });
  assert.deepEqual(h.degraded, []);
  assert.equal(h.degradedCount, 0);
});

test("decodePluginHealth decodes a degraded entry", () => {
  const h = decodePluginHealth({
    snapshot: {
      degraded: [
        {
          plugin: "com.example.audio",
          reason: "admit_failures_exhausted (count=3)",
          suggested_action: "plugin_restore"
        }
      ],
      degraded_count: 1
    }
  });
  assert.equal(h.degraded.length, 1);
  assert.equal(h.degraded[0].plugin, "com.example.audio");
  assert.equal(h.degradedCount, 1);
});

test("decodePluginHealth maps an absent degraded_count to null", () => {
  const h = decodePluginHealth({ snapshot: { degraded: [] } });
  assert.equal(h.degradedCount, null);
});

// --- plugin_degraded / plugin_restored happenings ----------------

test("decodePluginDegradedEvent decodes a plugin_degraded happening", () => {
  const ev = decodePluginDegradedEvent({
    type: "plugin_degraded",
    plugin: "com.example.audio",
    reason: "plugin_panic",
    detail: "index out of bounds",
    at: { secs_since_epoch: 1716400000, nanos_since_epoch: 0 }
  });
  assert.equal(ev?.plugin, "com.example.audio");
  assert.equal(ev?.reason, "plugin_panic");
  assert.equal(ev?.detail, "index out of bounds");
});

test("decodePluginRestoredEvent decodes a plugin_restored happening", () => {
  const ev = decodePluginRestoredEvent({
    happening: {
      type: "plugin_restored",
      plugin: "com.example.audio",
      source: "operator_restore",
      at: { secs_since_epoch: 1716400001, nanos_since_epoch: 0 }
    }
  });
  assert.equal(ev?.plugin, "com.example.audio");
  assert.equal(ev?.source, "operator_restore");
});

test("plugin_degraded / plugin_restored decoders reject other frames", () => {
  assert.equal(
    decodePluginDegradedEvent({ type: "plugin_restored", plugin: "x" }),
    null
  );
  assert.equal(
    decodePluginRestoredEvent({ type: "plugin_degraded", plugin: "x" }),
    null
  );
  assert.equal(decodePluginDegradedEvent(null), null);
});

test("pluginDegradedReasonMessage maps each reason prefix", () => {
  assert.match(
    pluginDegradedReasonMessage("admit_failures_exhausted (count=3)"),
    /Admission kept failing/
  );
  assert.match(
    pluginDegradedReasonMessage("teardown_timeouts_exhausted (count=2)"),
    /stopped responding to teardown/
  );
  assert.match(
    pluginDegradedReasonMessage("plugin_panic: boom"),
    /panicked/
  );
});
