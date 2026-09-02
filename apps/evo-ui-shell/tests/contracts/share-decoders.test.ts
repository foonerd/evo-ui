// Contract: networking.shares wire shapes (Phase 3c). The share
// record and state fixtures are VERBATIM live captures from the
// bench (probe share created, captured, removed 2026-07-18) - if
// these break, the wire moved.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeConfiguredShares,
  decodeConfiguredSharesHappening,
  decodeDiscoveredNas,
  decodeShareState,
  decodeShareStateHappening
} from "../../src/features/sources/share-decoders.ts";

// Verbatim live record.
const LIVE_SHARE = {
  share_id: "8aca6fe9-dedd-499d-8b72-dca4e626e130",
  alias: "probe",
  fstype: "cifs",
  host: "192.0.2.99",
  path: "Music",
  credentials: { kind: "guest" },
  advanced_options: "",
  persisted_vers: null,
  mount_root: "/mnt/NAS/probe",
  created_at_ms: 1784369099706,
  last_mounted_at_ms: null
};

// Verbatim live state envelope.
const LIVE_STATE = {
  envelope: {
    share_id: "8aca6fe9-dedd-499d-8b72-dca4e626e130",
    alias: "probe",
    state: "failed",
    reason: "CIFS dialect probe exhausted",
    negotiated_vers: null,
    last_transition_at_ms: 1784369099745
  }
};

test("live share record decodes", () => {
  const s = decodeConfiguredShares({ envelope: { shares: [LIVE_SHARE] } });
  assert.ok(s !== null);
  assert.equal(s.shares.length, 1);
  const r = s.shares[0];
  assert.equal(r.shareId, LIVE_SHARE.share_id);
  assert.equal(r.alias, "probe");
  assert.equal(r.fstype, "cifs");
  assert.equal(r.credentialsKind, "guest");
  assert.equal(r.mountRoot, "/mnt/NAS/probe");
  assert.equal(r.persistedVers, null);
});

test("live state envelope decodes", () => {
  const st = decodeShareState(LIVE_STATE);
  assert.ok(st !== null);
  assert.equal(st.shareId, LIVE_SHARE.share_id);
  assert.equal(st.state, "failed");
  assert.ok(st.reason !== null && st.reason.includes("dialect probe"));
  assert.equal(st.negotiated, null);
});

test("state happening gates on subject type", () => {
  const good = decodeShareStateHappening({
    type: "subject_state_changed",
    subject_type: "network_share_state",
    new_state: LIVE_STATE.envelope
  });
  assert.ok(good !== null);
  assert.equal(good.state, "failed");
  assert.equal(
    decodeShareStateHappening({
      type: "subject_state_changed",
      subject_type: "system_network_shares_configured",
      new_state: LIVE_STATE.envelope
    }),
    null
  );
});

test("configured happening gates on subject type", () => {
  const good = decodeConfiguredSharesHappening({
    type: "subject_state_changed",
    subject_type: "system_network_shares_configured",
    new_state: { shares: [LIVE_SHARE] }
  });
  assert.ok(good !== null);
  assert.equal(good.shares.length, 1);
});

test("empty envelopes and malformed records degrade", () => {
  const empty = decodeConfiguredShares({ envelope: { shares: [] } });
  assert.ok(empty !== null && empty.shares.length === 0);
  const partial = decodeConfiguredShares({
    envelope: { shares: [{ alias: "no-id" }, LIVE_SHARE] }
  });
  assert.ok(partial !== null);
  assert.equal(partial.shares.length, 1);
});

test("discovered nas record decodes (verbatim live shape)", () => {
  const n = decodeDiscoveredNas({
    envelope: {
      nas: [
        // Verbatim live record 2026-07-18.
        {
          name: "TESTBOX",
          ip: "192.0.2.41",
          advertised_dialect: "SMB3_11",
          shares: [{ name: "nobody", comment: "Home Directories" }]
        },
        { name: "OLDBOX", ip: "192.0.2.7", already_configured: true, shares: ["Music"] }
      ]
    }
  });
  assert.ok(n !== null);
  assert.equal(n.nas.length, 2);
  assert.equal(n.nas[0].host, "192.0.2.41");
  assert.equal(n.nas[0].dialect, "SMB3_11");
  assert.deepEqual(n.nas[0].shares, ["nobody"]);
  assert.deepEqual(n.nas[1].shares, ["Music"]);
  assert.equal(n.nas[1].alreadyConfigured, true);
});
