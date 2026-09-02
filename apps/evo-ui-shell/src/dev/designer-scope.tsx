// Designer scope - which of the two screens the designer is editing.
//
// NATIVE: the hardware-attached panel selected in the screen picker;
// layout writes go to that screen's byTarget key (custom size ->
// generic custom slot). REMOTE: the single browser-facing scope;
// layout writes go to ui.profile.remote, and the editing base when
// nothing is stored is the DERIVED full-reference view (copy-on-write,
// like the home default). The scopes edit and reset independently by
// ruling (2026-07-10).
//
// A context, not a prop chain: the Pages/Menu editors and the build
// stage all route their writes by this one value, and the scope
// banner in each tab keeps the binding visible - invisible scoping
// was the root defect the two-scope model fixes.

import type { ComponentChildren, JSX } from "preact";
import { createContext } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";

import type { SessionScope } from "../runtime/session-scope";

interface DesignerScopeValue {
  readonly scope: SessionScope;
  setScope: (next: SessionScope) => void;
}

const DesignerScopeContext = createContext<DesignerScopeValue | null>(null);

export function DesignerScopeProvider({
  children
}: {
  children: ComponentChildren;
}): JSX.Element {
  const [scope, setScope] = useState<SessionScope>("native");
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return (
    <DesignerScopeContext.Provider value={value}>
      {children}
    </DesignerScopeContext.Provider>
  );
}

/** Native outside the designer workshop - the device App never mounts
 *  the provider and resolves its own scope from the session. */
export function useDesignerScope(): DesignerScopeValue {
  const ctx = useContext(DesignerScopeContext);
  if (ctx !== null) {
    return ctx;
  }
  return { scope: "native", setScope: () => {} };
}
