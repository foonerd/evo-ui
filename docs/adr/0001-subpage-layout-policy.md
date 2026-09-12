# ADR 0001 - Subpage Layout Policy (UI-only)

Status: Accepted  
Date: 2026-05-09  
Scope: UI behavior only

## Context

User and stakeholder review confirmed that the three-column landing layout works well for home playback.  
The same persistent three-column treatment on subpages (queue, browse, system, operations) introduces visual clutter and weakens task focus when no high-value secondary context is needed.

## Decision

Adopt a context-driven layout policy:

- Home/landing view defaults to three columns.
- All subpages default to two columns (navigation + main view).
- A third column on a subpage is opt-in and allowed only when the subpage has explicit, approved secondary context/preview value.

## Consequences

Positive:

- Stronger task focus on management/configuration subpages.
- Less UI clutter and lower cognitive load.
- Three-column layout remains a deliberate, high-value pattern rather than always-on chrome.

Constraints:

- Any subpage requesting third-column behavior must document purpose and approval before rollout.
- This ADR does not change gateway/core/plugin contracts; it governs UI layout behavior only.
