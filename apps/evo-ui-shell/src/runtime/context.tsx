// Runtime context. The Shell mounts a single provider near the root
// and every widget consumes the handle via `useRuntime()`. Widgets
// dispatch wire ops through `runtime.client`, subscribe to subjects
// through `runtime.subjects`, navigate through `runtime.navigate`,
// etc. — without any per-widget prop drilling.

import { createContext } from "preact";
import { useContext } from "preact/hooks";

import type { Runtime } from "./boot";

export const RuntimeContext = createContext<Runtime | null>(null);

/**
 * Resolve the active runtime. Refuses with a structured error
 * when called outside the Shell's `<RuntimeContext.Provider>`,
 * since every widget mount is downstream of that provider.
 */
export function useRuntime(): Runtime {
  const r = useContext(RuntimeContext);
  if (r === null) {
    throw new Error(
      "useRuntime() called outside <RuntimeContext.Provider>; mount the widget inside the Shell tree.",
    );
  }
  return r;
}
