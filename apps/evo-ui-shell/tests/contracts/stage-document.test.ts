import test from "node:test";
import assert from "node:assert/strict";

import {
  CLASSIC_STAGE,
  decodeStageDoc,
  ensureStageContracts,
  STAGE_CONTRACT_ATOMS,
  stageNodeCss,
  stageSectionsVisible,
} from "../../src/runtime/stage-document.ts";
import { decodeLayoutDocument } from "../../src/runtime/layout-document.ts";

const allAtoms = (doc: typeof CLASSIC_STAGE) =>
  doc.sections.flatMap((s) =>
    s.cols.flatMap((c) => c.rows.flatMap((r) => r.cells.flatMap((l) => l.atoms.map((b) => b.kind))))
  );

test("classic stage carries every contract atom and round-trips decode", () => {
  const decoded = decodeStageDoc(JSON.parse(JSON.stringify(CLASSIC_STAGE)))!;
  assert.deepEqual(decoded, CLASSIC_STAGE);
  const present = new Set(allAtoms(decoded));
  for (const k of STAGE_CONTRACT_ATOMS) assert.ok(present.has(k), k);
});

test("decode drops junk, clamps weights/priority, guarantees contracts", () => {
  const doc = decodeStageDoc({
    sections: [
      { weight: 99, foldPriority: 9, cols: [
        { weight: -3, rows: [
          { cells: [{ weight: 1, atoms: [{ kind: "viz" }, { kind: "nope" }, 7] }] },
          "junk",
        ]},
      ]},
      "junk",
      { cols: [] },
    ],
  })!;
  assert.equal(doc.sections[0].weight, 24);
  assert.equal(doc.sections[0].foldPriority, 5);
  assert.equal(doc.sections[0].cols[0].weight, 1);
  assert.deepEqual(
    doc.sections[0].cols[0].rows[0].cells[0].atoms.map((b) => b.kind),
    ["viz"]
  );
  // Contracts appended in a synthesized never-folding final section.
  const last = doc.sections[doc.sections.length - 1];
  assert.equal(last.foldPriority, 5);
  assert.deepEqual(
    new Set(last.cols.flatMap((c) => c.rows.flatMap((r) => r.cells.flatMap((l) => l.atoms.map((b) => b.kind))))),
    STAGE_CONTRACT_ATOMS
  );
});

test("legacy v1 documents upgrade: rows->sections, stacks->rows, inline->one line", () => {
  const doc = decodeStageDoc({
    rows: [
      { weight: 2, foldPriority: 5, cells: [
        { weight: 2, blocks: [{ kind: "art" }] },
        { weight: 3, blocks: [{ kind: "title" }, { kind: "artist" }] }, // stacked
      ]},
      { weight: 1, foldPriority: 3, cells: [
        { weight: 1, flow: "inline", blocks: [{ kind: "bitrate" }, { kind: "codec" }, { kind: "fav" }] },
      ]},
    ],
  })!;
  // v1 row 1 -> section with two columns; the stacked cell became two rows.
  assert.equal(doc.sections[0].cols.length, 2);
  assert.equal(doc.sections[0].cols[1].rows.length, 2);
  assert.equal(doc.sections[0].cols[1].rows[0].cells[0].atoms[0].kind, "title");
  // v1 inline cell -> ONE row, ONE cell, three adjacent atoms.
  assert.equal(doc.sections[1].cols[0].rows.length, 1);
  assert.deepEqual(
    doc.sections[1].cols[0].rows[0].cells[0].atoms.map((b) => b.kind),
    ["bitrate", "codec", "fav"]
  );
  // Contracts guaranteed (play/volume were absent in the legacy doc).
  const present = new Set(allAtoms(doc));
  for (const k of STAGE_CONTRACT_ATOMS) assert.ok(present.has(k), k);
});

test("cell alignment fields decode and default correctly", () => {
  const doc = decodeStageDoc({ sections: [
    { weight: 1, foldPriority: 5, cols: [{ weight: 1, rows: [
      { weight: 1, cells: [
        { weight: 1, ha: "justify", va: "bottom", atoms: [{ kind: "title" }, { kind: "artist" }, { kind: "play" }, { kind: "volume" }] },
        { weight: 1, ha: "wat", va: 3, atoms: [] },
      ]},
    ]}]},
  ]})!;
  const cells = doc.sections[0].cols[0].rows[0].cells;
  assert.equal(cells[0].ha, "justify");
  assert.equal(cells[0].va, "bottom");
  assert.equal("ha" in cells[1], false);
  assert.equal("va" in cells[1], false);
});

test("ensureStageContracts is a no-op when everything is present", () => {
  assert.equal(ensureStageContracts(CLASSIC_STAGE), CLASSIC_STAGE);
});

test("sections shed lowest fold priority first; priority 5 never sheds", () => {
  // classic priorities: 5,5,4,5,3
  const vis = stageSectionsVisible(CLASSIC_STAGE, 3);
  assert.deepEqual(vis.map((s) => s.foldPriority), [5, 5, 5]);
  assert.equal(stageSectionsVisible(CLASSIC_STAGE, 1).length, 3);
});

test("page.stage rides the layout document decode, junk drops, spacer/nav are atoms", () => {
  const doc = decodeLayoutDocument({
    schemaVersion: 1,
    pages: [
      { id: "home", name: "Home", regions: {}, stage: { sections: [
        { weight: 1, foldPriority: 5, cols: [{ weight: 1, rows: [{ weight: 1, cells: [
          { weight: 1, atoms: [
            { kind: "title" }, { kind: "artist" }, { kind: "play" }, { kind: "volume" },
            { kind: "spacer" }, { kind: "nav" },
          ]},
        ]}]}]},
      ]}},
    ],
    nav: { position: "left", entries: [] },
  })!;
  const atoms = doc.pages[0].stage!.sections[0].cols[0].rows[0].cells[0].atoms.map((b) => b.kind);
  assert.ok(atoms.includes("spacer") && atoms.includes("nav"));
  const junk = decodeLayoutDocument({
    schemaVersion: 1,
    pages: [{ id: "home", name: "H", regions: {}, stage: "garbage" }],
    nav: { position: "left", entries: [] },
  })!;
  assert.equal("stage" in junk.pages[0], false);
});

test("v2.1 controls decode: pad common/per-side, scale clamps, style tokens; defaults OMITTED", () => {
  const doc = decodeStageDoc({ sections: [
    { weight: 1, foldPriority: 5, pad: 3, scale: 120, style: { bg: "card", rad: 2 },
      cols: [{ weight: 1, pad: { t: 2, r: 0, b: 0, l: 1 }, scale: 999, rows: [
        { weight: 1, scale: 47, style: { bd: "accent", op: 70 }, cells: [
          { weight: 1, pad: { t: 2, r: 2, b: 2, l: 2 }, scale: 100, style: { bg: "wat", rad: 9 },
            atoms: [{ kind: "title" }, { kind: "artist" }, { kind: "play" }, { kind: "volume" }] },
        ]},
      ]}]},
  ]})!;
  const sec = doc.sections[0];
  assert.equal(sec.pad, 3);
  assert.equal(sec.scale, 120);
  assert.deepEqual(sec.style, { bg: "card", rad: 2 });
  const col = sec.cols[0];
  assert.deepEqual(col.pad, { t: 2, r: 0, b: 0, l: 1 }); // granular survives
  assert.equal(col.scale, 200);                          // clamped to max
  const row = col.rows[0];
  assert.equal(row.scale, 50);                           // clamped to min
  assert.deepEqual(row.style, { bd: "accent", op: 70 });
  const cl = row.cells[0];
  assert.equal(cl.pad, 2);                 // uniform object collapses to common
  assert.equal("scale" in cl, false);      // 100 = neutral = omitted
  assert.equal("style" in cl, false);      // junk-only style dropped entirely
});

test("v2.1 controls round-trip decode unchanged (stored form is canonical)", () => {
  const doc = decodeStageDoc({ sections: [
    { weight: 2, foldPriority: 4, pad: { t: 1, r: 0, b: 3, l: 0 }, scale: 130,
      style: { bg: "tint", bd: "hairline", rad: 1, op: 85 },
      cols: [{ weight: 1, rows: [{ weight: 1, cells: [
        { weight: 1, atoms: [{ kind: "title" }, { kind: "artist" }, { kind: "play" }, { kind: "volume" }] },
      ]}]}]},
  ]})!;
  const again = decodeStageDoc(JSON.parse(JSON.stringify(doc)))!;
  assert.deepEqual(again, doc);
});

test("stageNodeCss: ONE mapping for glass and canvas", () => {
  assert.deepEqual(stageNodeCss({}), {});
  assert.deepEqual(stageNodeCss({ pad: 2 }), { padding: "0.5rem" });
  assert.deepEqual(
    stageNodeCss({ pad: { t: 3, r: 0, b: 0, l: 1 } }),
    { padding: "0.75rem 0rem 0rem 0.25rem" }
  );
  assert.deepEqual(stageNodeCss({ scale: 120 }), { fontSize: "120%" });
  const css = stageNodeCss({ style: { bg: "card", bd: "hairline", rad: 2, op: 70 } });
  assert.equal(css.background, "var(--card)");
  assert.equal(css.border, "1px solid var(--border)");
  assert.equal(css.borderRadius, "0.75rem");
  assert.equal(css.opacity, "0.7");
});

test("classic default carries NO v2.1 controls (byte-stable shipped arrangement)", () => {
  const walk = (n: Record<string, unknown>) => {
    assert.equal("pad" in n, false);
    assert.equal("scale" in n && typeof n.scale === "number" && n.scale > 3, false);
    assert.equal("style" in n, false);
  };
  for (const s of CLASSIC_STAGE.sections) {
    walk(s as never);
    for (const c of s.cols) { walk(c as never);
      for (const r of c.rows) { walk(r as never);
        for (const l of r.cells) walk(l as never); } }
  }
});
