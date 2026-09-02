import type { ComponentChildren } from "preact";
import type { CapabilityStatus } from "../../core/types";

interface CapabilityGateProps {
  title: string;
  status: CapabilityStatus;
  description: string;
  children: ComponentChildren;
  partialHint?: string;
  missingHint?: string;
  hideHeader?: boolean;
}

export function CapabilityGate({
  title,
  status,
  description,
  children,
  partialHint,
  missingHint,
  hideHeader = false
}: CapabilityGateProps) {
  return (
    <section className="card feature-surface">
      {hideHeader ? null : (
        <div className="feature-head">
          <div>
            <h3>{title}</h3>
            <p className="feature-description">{description}</p>
          </div>
          <span className={`pill pill-${status}`}>{status}</span>
        </div>
      )}

      {status === "missing" ? (
        <p className="feature-hint">
          {missingHint ?? "Feature unavailable on this runtime. Kept safe-disabled."}
        </p>
      ) : (
        <>
          {children}
          {status === "partial" ? (
            <p className="feature-hint">
              {partialHint ?? "Partial capability: only safe subset controls are enabled."}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
