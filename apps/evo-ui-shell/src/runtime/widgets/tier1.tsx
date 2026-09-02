// Tier 1 universal widget components.
//
// Each component renders one of the framework's 23 universal widget
// kinds. The components are deliberately minimal at this layer — the
// renderer mounts them to demonstrate the schema-first projection
// pipeline end-to-end; later waves elaborate them into the full
// operator-facing surface (prompt forms with validation, theme
// picker with live preview, wizard step navigation, etc.) and pair
// them with the design-token system the showcase delivers.

import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type { WidgetProps } from "./registry";
import { useRuntime } from "../context";

function WidgetCard(props: {
  title: string;
  subtitle?: string;
  children?: ComponentChildren;
  kind: string;
}): JSX.Element {
  return (
    <article class={`evo-widget evo-widget--${slug(props.kind)}`} data-widget-kind={props.kind}>
      <header class="evo-widget__header">
        <h3 class="evo-widget__title">{props.title}</h3>
        {props.subtitle !== undefined && (
          <p class="evo-widget__subtitle">{props.subtitle}</p>
        )}
      </header>
      {props.children !== undefined && (
        <div class="evo-widget__body">{props.children}</div>
      )}
      <footer class="evo-widget__footer">
        <code class="evo-widget__kind">{props.kind}</code>
      </footer>
    </article>
  );
}

function slug(kind: string): string {
  return kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function envelopeField(props: WidgetProps, key: string): string {
  const v = props.envelope[key];
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

// --- Operator-tile family --------------------------------------

export function WidgetPluginsEntry(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title={envelopeField(props, "label") || "Plugins"}
      subtitle="Operator entry into the plugin lifecycle surface."
    />
  );
}

export function WidgetDiagnosticsEntry(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title={envelopeField(props, "label") || "Diagnostics"}
      subtitle="Operator entry into the diagnostics + observability surface."
    />
  );
}

export function WidgetUpdatesEntry(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title={envelopeField(props, "label") || "Updates"}
      subtitle="Operator entry into the three-channel update model."
    />
  );
}

// --- Prompt family ---------------------------------------------

function PromptCard(
  props: WidgetProps & { kindLabel: string; bodyHint?: string },
): JSX.Element {
  const promptId = envelopeField(props, "prompt_id");
  const promptText =
    envelopeField(props, "prompt") ||
    envelopeField(props, "message") ||
    props.kindLabel;
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title={props.kindLabel}
      subtitle={promptId !== "" ? `prompt_id: ${promptId}` : undefined}
    >
      <p class="evo-widget__prompt-text">{promptText}</p>
      {props.bodyHint !== undefined && (
        <p class="evo-widget__prompt-hint">{props.bodyHint}</p>
      )}
    </WidgetCard>
  );
}

export function WidgetPromptText(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Text prompt" />;
}

export function WidgetPromptPassword(props: WidgetProps): JSX.Element {
  return (
    <PromptCard
      {...props}
      kindLabel="Password prompt"
      bodyHint="Input is masked; presented value is captured under the prompt's response shape."
    />
  );
}

export function WidgetPromptSelect(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Select prompt" />;
}

export function WidgetPromptSelectWithOther(props: WidgetProps): JSX.Element {
  return (
    <PromptCard
      {...props}
      kindLabel="Select-with-other prompt"
      bodyHint='Operator may choose a listed option or supply an "other" value.'
    />
  );
}

export function WidgetPromptMultiSelect(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Multi-select prompt" />;
}

export function WidgetPromptConfirm(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Confirm prompt" />;
}

export function WidgetPromptMultiField(props: WidgetProps): JSX.Element {
  return (
    <PromptCard
      {...props}
      kindLabel="Multi-field prompt"
      bodyHint="Composite form; envelope.fields lists each captured field."
    />
  );
}

export function WidgetPromptExternalRedirect(props: WidgetProps): JSX.Element {
  const target = envelopeField(props, "url") || envelopeField(props, "target");
  return (
    <PromptCard
      {...props}
      kindLabel="External-redirect prompt"
      bodyHint={
        target !== "" ? `Redirect target: ${target}` : "Redirect target absent."
      }
    />
  );
}

export function WidgetPromptDatetime(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Date/time prompt" />;
}

export function WidgetPromptFreeform(props: WidgetProps): JSX.Element {
  return <PromptCard {...props} kindLabel="Freeform prompt" />;
}

// --- Multi-room -------------------------------------------------

export function WidgetRoomsEntry(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title="Rooms"
      subtitle="Multi-room group entry; surfaces discovered peers + groups."
    />
  );
}

// --- Operator-selectable ---------------------------------------

export function WidgetThemePicker(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title="Theme"
      subtitle="Operator-selectable visual theme; backed by ui_active_theme."
    />
  );
}

export function WidgetUiShellPicker(props: WidgetProps): JSX.Element {
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title="UI shell"
      subtitle="Operator-selectable UI shell; admitted shells are listed alongside the framework default."
    />
  );
}

// --- Status surfaces -------------------------------------------

export function WidgetStatusBadge(props: WidgetProps): JSX.Element {
  const label = envelopeField(props, "label") || envelopeField(props, "text");
  const level = envelopeField(props, "level") || "info";
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title="Status"
      subtitle={`level: ${level}`}
    >
      <p class="evo-widget__status-badge" data-level={level}>
        {label || "-"}
      </p>
    </WidgetCard>
  );
}

// --- First-boot wizard family ----------------------------------

type WizardCompletionState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "submitted"; readonly recordedStepId: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * Plain-step wizard card. Renders a single "Acknowledge" button
 * that dispatches `record_wizard_step_completion` with
 * `kind: "plain_step"`. The framework's WizardRuntime advances
 * the persisted resume cursor; the next boot will skip this step
 * if the runtime is mid-walk.
 */
function PlainWizardStep(props: WidgetProps & { step: string }): JSX.Element {
  const runtime = useRuntime();
  const [state, setState] = useState<WizardCompletionState>({ kind: "idle" });
  const stepId = envelopeField(props, "step_id") || props.step;
  const acknowledge = async (): Promise<void> => {
    setState({ kind: "submitting" });
    const result = await runtime.client.ui.recordWizardStepCompletion({
      step_id: stepId,
      completion: { kind: "plain_step" },
    });
    if (result.error !== undefined) {
      setState({
        kind: "error",
        message: `${result.error.code}: ${result.error.message}`,
      });
      return;
    }
    setState({ kind: "submitted", recordedStepId: stepId });
  };
  return (
    <WidgetCard
      kind={props.widgetKindId}
      title={`Wizard - ${props.step}`}
      subtitle={`step_id: ${stepId}`}
    >
      <WizardStatus state={state} />
      {state.kind !== "submitted" && (
        <button
          class="evo-wizard__acknowledge"
          type="button"
          onClick={() => void acknowledge()}
          disabled={state.kind === "submitting"}
        >
          {state.kind === "submitting" ? "Recording…" : "Acknowledge"}
        </button>
      )}
    </WidgetCard>
  );
}

/**
 * Consent-step wizard card. Renders Accept / Decline controls
 * that dispatch `record_wizard_step_completion` with
 * `kind: "consent"`. The framework's WizardRuntime appends a
 * signed entry to the `evo.consent` ledger with the supplied
 * consent_id + document_hash + decision before advancing the
 * persisted resume cursor.
 */
export function WidgetWizardConsent(props: WidgetProps): JSX.Element {
  const runtime = useRuntime();
  const [state, setState] = useState<WizardCompletionState>({ kind: "idle" });
  const stepId = envelopeField(props, "step_id") || "consent";
  const consentId = envelopeField(props, "consent_id");
  const documentHash = envelopeField(props, "document_hash");
  const userId =
    envelopeField(props, "user_id") !== "" ? envelopeField(props, "user_id") : undefined;

  const dispatch = async (
    decision: "accepted" | "declined",
  ): Promise<void> => {
    if (consentId === "" || documentHash === "") {
      setState({
        kind: "error",
        message:
          "consent stocking envelope is missing consent_id / document_hash; cannot dispatch",
      });
      return;
    }
    setState({ kind: "submitting" });
    const payload: Record<string, unknown> = {
      step_id: stepId,
      completion: {
        kind: "consent",
        consent_id: consentId,
        document_hash: documentHash,
        decision,
      },
    };
    if (userId !== undefined) {
      (payload.completion as Record<string, unknown>).user_id = userId;
    }
    const result = await runtime.client.ui.recordWizardStepCompletion(payload);
    if (result.error !== undefined) {
      setState({
        kind: "error",
        message: `${result.error.code}: ${result.error.message}`,
      });
      return;
    }
    setState({ kind: "submitted", recordedStepId: stepId });
  };

  return (
    <WidgetCard
      kind={props.widgetKindId}
      title="Wizard - consent"
      subtitle={`consent_id: ${consentId || "<missing>"}`}
    >
      <p class="evo-wizard__consent-document">
        Document hash: <code>{documentHash || "<missing>"}</code>
      </p>
      <WizardStatus state={state} />
      {state.kind !== "submitted" && (
        <div class="evo-wizard__consent-actions">
          <button
            type="button"
            class="evo-wizard__accept"
            onClick={() => void dispatch("accepted")}
            disabled={state.kind === "submitting"}
          >
            Accept
          </button>
          <button
            type="button"
            class="evo-wizard__decline"
            onClick={() => void dispatch("declined")}
            disabled={state.kind === "submitting"}
          >
            Decline
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

function WizardStatus(props: { state: WizardCompletionState }): JSX.Element {
  switch (props.state.kind) {
    case "idle":
      return <p class="evo-wizard__status evo-wizard__status--idle" />;
    case "submitting":
      return (
        <p class="evo-wizard__status evo-wizard__status--submitting">
          Recording step completion…
        </p>
      );
    case "submitted":
      return (
        <p class="evo-wizard__status evo-wizard__status--submitted">
          Step <code>{props.state.recordedStepId}</code> recorded.
        </p>
      );
    case "error":
      return (
        <p class="evo-wizard__status evo-wizard__status--error">
          Record refused: {props.state.message}
        </p>
      );
  }
}

export function WidgetWizardWelcome(props: WidgetProps): JSX.Element {
  return <PlainWizardStep {...props} step="welcome" />;
}

export function WidgetWizardLocalization(props: WidgetProps): JSX.Element {
  return <PlainWizardStep {...props} step="localization" />;
}

export function WidgetWizardNetwork(props: WidgetProps): JSX.Element {
  return <PlainWizardStep {...props} step="network" />;
}

export function WidgetWizardMultiroom(props: WidgetProps): JSX.Element {
  return <PlainWizardStep {...props} step="multiroom" />;
}

export function WidgetWizardCompletion(props: WidgetProps): JSX.Element {
  return <PlainWizardStep {...props} step="completion" />;
}
