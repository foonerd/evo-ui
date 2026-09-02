# Engineering bar — mandatory gate per task

Every task, PR, or code edit that touches `evo-ui-shell` layout/display must answer all six questions **before merge**. Copy the block below into the PR description or commit notes.

**Honest scoring:** “Yes” means demonstrable in this change (test, doc, or preset row). “Partial” is allowed with one sentence of evidence. “No” blocks merge unless the task is explicitly red in `UI_ARCHITECTURE_ONE_PAGE.md` (resolve in implementation, not in design).

---

## The six questions

| # | Question | Pass criteria |
|---|----------|---------------|
| 1 | **Engineering excellence showcase?** | Clear structure, tested behaviour, matches one-pager; no hack on hot path |
| 2 | **Versatile, robust solution?** | Works across preset catalogue / size classes without one-off CSS |
| 3 | **Enterprise industry grade?** | Capability-gated where needed; resettable defaults; supportable |
| 4 | **Thinking outside the box?** | Disciplined innovation (pivot, preset+inches), not gimmick |
| 5 | **Next generation, never done before?** | **Not required.** Combination + rigour is the claim |
| 6 | **Effort led by facts, not guesswork?** | Contract test, preset test row, or measured viewport — not “looks fine” |

---

## Copy-paste template (per task)

```markdown
### Engineering bar — [task name]

| Question | Answer | Evidence |
|----------|--------|----------|
| Excellence showcase? | Yes / Partial / No | |
| Versatile, robust? | Yes / Partial / No | |
| Enterprise grade? | Yes / Partial / No | |
| Outside the box? | Yes / Partial / No | |
| Never done before? | N/A (by design) | |
| Facts not guesswork? | Yes / Partial / No | |

Architecture alignment: UI_ARCHITECTURE_ONE_PAGE.md — green items unchanged.
```

---

## Quick reject rules

Reject the change if it:

- Adds Tier 0 landing widgets or plugin-specific layout CSS
- Keys UI scale on W×H only (ignores preset / inches)
- Collapses preset testing into “close enough” W×H buckets
- Implements on-device drag designer for miniature panels
- Skips contract tests for pure presentation logic

---

## Reference

- Alignment: `UI_ARCHITECTURE_ONE_PAGE.md`
- Display catalogue: `DISPLAY_RESOLUTIONS.md`
- Pivot / designer: `SMALL_SCREEN_PIVOT.md`
- Fold tiers: `docs/RESPONSIVE_FOLD_MODEL.md`
