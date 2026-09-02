// Contract: notifications wire shapes (Phase 2b). The fixture is a
// VERBATIM live envelope captured from the demo emitter - if these
// tests break, the wire moved.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeNotificationsState,
  decodeNotificationsHappening,
  sortNotifications,
  humaniseKey,
  formatMinute,
  parseTimeToMinute
} from "../../src/features/notifications/notification-decoders.ts";

const LIVE_ENVELOPE = {
  envelope: {
    active: [
      {
        handle: 0,
        level: "info",
        source_plugin: "com.example.doorbell",
        title_key: "doorbell.front_door.title.1",
        body_key: "doorbell.front_door.body",
        audio_payload: { audio_uri: "evo://assets/chime/doorbell.wav", tts_text_key: null, volume_relative: 1.0 },
        actions: [
          { kind: "invoke_verb", plugin_id: "com.example.doorbell", verb: "answer", payload: [] },
          { kind: "invoke_verb", plugin_id: "com.example.doorbell", verb: "snooze_5m", payload: [] },
          { kind: "dismiss" }
        ],
        priority: "routine",
        group_with: "doorbell",
        auto_dismiss_after_ms: 30000,
        resolved_mode: "display_only",
        group_count: 2,
        sent_at: { secs_since_epoch: 1784359913, nanos_since_epoch: 309589786 }
      }
    ],
    base_mode: "display_only",
    quiet_hours_active: false,
    quiet_hours_policy: { start_minute: 0, end_minute: 0, downgrade_mode: "display_only" },
    last_update_at: { secs_since_epoch: 1784359913, nanos_since_epoch: 309597068 }
  }
};

test("live read envelope decodes", () => {
  const s = decodeNotificationsState(LIVE_ENVELOPE);
  assert.ok(s !== null);
  assert.equal(s.active.length, 1);
  const n = s.active[0];
  assert.equal(n.handle, 0);
  assert.equal(n.sourcePlugin, "com.example.doorbell");
  assert.equal(n.priority, "routine");
  assert.equal(n.groupCount, 2);
  assert.equal(n.autoDismissAfterMs, 30000);
  assert.equal(n.actions.length, 3);
  assert.deepEqual(n.actions[2], { kind: "dismiss" });
  assert.equal(s.baseMode, "display_only");
  assert.equal(s.quietHoursActive, false);
  assert.equal(s.quietHours.downgradeMode, "display_only");
});

test("bare envelope body (happening new_state shape) decodes too", () => {
  const s = decodeNotificationsState(LIVE_ENVELOPE.envelope);
  assert.ok(s !== null);
  assert.equal(s.active.length, 1);
});

test("happening decode gates on type + subject_type", () => {
  const good = decodeNotificationsHappening({
    type: "subject_state_changed",
    subject_type: "system_notifications_active",
    new_state: LIVE_ENVELOPE.envelope
  });
  assert.ok(good !== null);
  assert.equal(
    decodeNotificationsHappening({
      type: "subject_state_changed",
      subject_type: "audio_queue",
      new_state: {}
    }),
    null
  );
  assert.equal(decodeNotificationsHappening({ type: "ui_shelf_changed" }), null);
});

test("sort: priority desc then newest first, critical pinned", () => {
  const mk = (handle: number, priority: string, secs: number) => ({
    handle, level: "info", source_plugin: "p", title_key: `t.${handle}`,
    priority, actions: [], group_count: 1,
    sent_at: { secs_since_epoch: secs, nanos_since_epoch: 0 }
  });
  const s = decodeNotificationsState({
    active: [mk(1, "routine", 300), mk(2, "critical", 100), mk(3, "important", 200), mk(4, "routine", 400)],
    base_mode: "chime", quiet_hours_active: false,
    quiet_hours_policy: { start_minute: 0, end_minute: 0, downgrade_mode: "display_only" }
  });
  assert.ok(s !== null);
  const order = sortNotifications(s.active).map((n) => n.handle);
  assert.deepEqual(order, [2, 3, 4, 1]);
});

test("unknown priority and action kinds degrade, never throw", () => {
  const s = decodeNotificationsState({
    active: [{ handle: 9, source_plugin: "p", title_key: "x.y",
      priority: "apocalyptic", actions: [{ kind: "navigate_to", screen_id: "s" }] }],
    base_mode: "chime", quiet_hours_active: false,
    quiet_hours_policy: {}
  });
  assert.ok(s !== null);
  assert.equal(s.active[0].priority, "routine");
  assert.deepEqual(s.active[0].actions[0], { kind: "unknown", raw: "navigate_to" });
});

test("quiet-hours minute round-trip", () => {
  assert.equal(formatMinute(1320), "22:00");
  assert.equal(formatMinute(420), "07:00");
  assert.equal(formatMinute(0), "00:00");
  assert.equal(parseTimeToMinute("22:00"), 1320);
  assert.equal(parseTimeToMinute("7:05"), 425);
  assert.equal(parseTimeToMinute("24:00"), null);
  assert.equal(parseTimeToMinute("nope"), null);
});

test("humaniseKey strips title/body/number segments", () => {
  assert.equal(humaniseKey("doorbell.front_door.title.1"), "Front door");
  assert.equal(humaniseKey("backup.complete.body"), "Complete");
  assert.equal(humaniseKey("snooze_5m"), "Snooze 5m");
});
