// Affordance map for settings group sub-pages.
//
// Each settings group is the same shape - a header + content area
// inside the Settings hub - but a small number of groups have a
// "dedicated view" outside the Settings hub for power-user workflows
// (multi-room is the first one; future cast / library may want the
// same pattern). The settings hub renders an inline "Open in
// dedicated view" affordance for groups that opt in here.
//
// Pure / testable: the predicate returns null when no dedicated view
// exists, or the operator-facing button label when one does. Tests
// in `tests/contracts/` verify only the eligible groups return a
// non-null label, guarding against the audit finding that the
// `onOpenMultiroom` callback was passed through the props chain but
// never wired into the rendered output.

export function settingsGroupDedicatedViewLabel(group: string): string | null {
  if (group === "multi-room") return "Open in dedicated view";
  return null;
}
