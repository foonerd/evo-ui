// prompt-origin-write - the glass that submitted Add share lists and
// answers on the SAME connection that dispatched the verb.
//
// The framework stamps answerable_by with that connection. The prompt
// seat socket is a different connection (kept separate so a token never
// rewrites LAN-trust playback). Listing only there is silence: the
// submitter cannot find its own card, and the seat holder (the player)
// is the only surface that paints. Add and mount stay on the shares
// write socket; this module is how that socket's origin list reaches
// PromptSurface. No password field on Sources. Pure.

import type { PromptItem } from "./prompt-decoders.ts";
import {
  originListSilence,
  type OriginListWire
} from "./origin-list.ts";

export function promptKey(item: { plugin: string; promptId: string }): string {
  return `${item.plugin}#${item.promptId}`;
}

/** Write-origin cards first (the submitter's), then seat extras. */
export function mergePromptLists(
  writePrompts: readonly PromptItem[],
  seatPrompts: readonly PromptItem[]
): PromptItem[] {
  const seen = new Set<string>();
  const out: PromptItem[] = [];
  for (const item of [...writePrompts, ...seatPrompts]) {
    const key = promptKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Answer / cancel ride the write socket for a card that socket listed. */
export function promptAnswerOnWrite(
  item: { plugin: string; promptId: string },
  writeKeys: ReadonlySet<string>
): boolean {
  return writeKeys.has(promptKey(item));
}

/** A write socket has no seat. Silence = none of ours. A failure keeps
 *  what already landed. A landed list replaces. */
export function applyOriginWriteList(
  prev: readonly PromptItem[],
  result: OriginListWire,
  decode: (raw: unknown) => PromptItem[] | null
): PromptItem[] {
  if (originListSilence(result, false)) return [];
  if (result.error !== undefined) return [...prev];
  const decoded = decode(result.value);
  return decoded !== null ? decoded : [...prev];
}

export function isPromptShelfChange(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  let rec = raw as Record<string, unknown>;
  const inner = rec["happening"];
  if (typeof inner === "object" && inner !== null) {
    rec = inner as Record<string, unknown>;
  }
  const variant = rec["type"] ?? rec["kind"] ?? rec["variant"];
  if (variant !== "ui_shelf_changed") return false;
  const shelf = rec["shelf"] ?? rec["shelf_id"] ?? rec["shelfId"];
  return shelf === "prompts.active";
}
