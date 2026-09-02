// prompt-decoders - wire shapes for the framework's plugin-initiated
// user-interaction prompts (Phase 1b).
//
// Grounded against the framework source at 2026-07-17:
//   - list_user_interactions response: { user_interactions: true,
//     prompts: [ { plugin, prompt: PromptRequest } ] }
//   - PromptRequest / PromptType / PromptResponse come from the
//     plugin SDK contract; PromptType and PromptResponse are
//     serde-tagged with `kind`, snake_case.
//   - answer_user_interaction: { plugin, prompt_id, response,
//     retain_for? }; cancel_user_interaction: { plugin, prompt_id }.
//
// The SDK contract REQUIRES consumers to render a newer-client
// fallback on unknown PromptType kinds rather than crash - decoded
// as kind "unknown" here; the surface renders it cancel-only.

export interface PromptOption {
  id: string;
  label: string;
}

export type PromptKind =
  | { kind: "text"; label: string; placeholder: string | null }
  | { kind: "password"; label: string }
  | { kind: "confirm"; message: string }
  | { kind: "select"; label: string; options: PromptOption[] }
  | { kind: "unknown"; raw: string };

export interface PromptItem {
  /** Canonical plugin name that issued the prompt. */
  plugin: string;
  promptId: string;
  promptType: PromptKind;
  /** Inline error the plugin attached on a re-issue. */
  errorContext: string | null;
  /** Wizard/flow grouping id. */
  sessionId: string | null;
}

/** Answer payloads mirror PromptType 1:1 on the wire. */
export type PromptAnswer =
  | { kind: "text"; value: string }
  | { kind: "password"; value: string }
  | { kind: "confirm"; value: boolean }
  | { kind: "select"; option_id: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function decodeOptions(raw: unknown): PromptOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptOption[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = str(entry, "id");
    const label = str(entry, "label");
    if (id !== null && label !== null) out.push({ id, label });
  }
  return out;
}

function decodePromptType(raw: unknown): PromptKind {
  if (!isObject(raw)) return { kind: "unknown", raw: "missing" };
  const kind = str(raw, "kind") ?? "missing";
  switch (kind) {
    case "text": {
      const label = str(raw, "label");
      if (label === null) return { kind: "unknown", raw: kind };
      return { kind: "text", label, placeholder: str(raw, "placeholder") };
    }
    case "password": {
      const label = str(raw, "label");
      if (label === null) return { kind: "unknown", raw: kind };
      return { kind: "password", label };
    }
    case "confirm": {
      const message = str(raw, "message");
      if (message === null) return { kind: "unknown", raw: kind };
      return { kind: "confirm", message };
    }
    case "select": {
      const label = str(raw, "label");
      const options = decodeOptions(raw["options"]);
      if (label === null || options.length === 0) {
        return { kind: "unknown", raw: kind };
      }
      return { kind: "select", label, options };
    }
    default:
      // select_with_other / multi_select / multi_field /
      // external_redirect land in later phases; until then they
      // take the mandated newer-client fallback path.
      return { kind: "unknown", raw: kind };
  }
}

/** Decode the list_user_interactions response envelope. Returns
 *  null when the envelope is not the user-interactions shape. */
export function decodeUserInteractions(raw: unknown): PromptItem[] | null {
  if (!isObject(raw)) return null;
  if (raw["user_interactions"] !== true) return null;
  const list = raw["prompts"];
  if (!Array.isArray(list)) return null;
  const out: PromptItem[] = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const plugin = str(entry, "plugin");
    const prompt = entry["prompt"];
    if (plugin === null || !isObject(prompt)) continue;
    const promptId = str(prompt, "prompt_id");
    if (promptId === null) continue;
    out.push({
      plugin,
      promptId,
      promptType: decodePromptType(prompt["prompt_type"]),
      errorContext: str(prompt, "error_context"),
      sessionId: str(prompt, "session_id")
    });
  }
  return out;
}

/** Build the answer_user_interaction request payload. */
export function encodeAnswer(
  item: PromptItem,
  answer: PromptAnswer
): Record<string, unknown> {
  return {
    plugin: item.plugin,
    prompt_id: item.promptId,
    response: answer
  };
}

/** Build the cancel_user_interaction request payload. */
export function encodeCancel(item: PromptItem): Record<string, unknown> {
  return { plugin: item.plugin, prompt_id: item.promptId };
}
