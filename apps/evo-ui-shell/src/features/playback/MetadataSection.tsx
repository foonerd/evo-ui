// Shared per-section metadata renderer - the reusable unit every metadata
// widget composes (individual, combined tabs, smart crawl).
//
// Renders a section's sources[] envelope: each provider that returned
// content, shown with its own text + attribution (name + QR). When two or
// more sources are present, per-source show/hide chips let the operator
// choose which appear - the "pinpoint reference" made interactive. Falls
// back to the top-level single source for legacy single-source sections,
// and degrades honestly: an empty section shows its empty line plus, when
// the cascade offered one, an "add a key" enhancement affordance.

import { useState } from "preact/hooks";
import { KeyRound } from "lucide-preact";
import { t } from "../../runtime/i18n";
import type { MessageKey } from "../../locales/en";
import { AttributionLine } from "./AttributionLine";
import type {
  EnrichmentSource,
  EnrichmentSourceEntry
} from "./track-detail-decoders";

function entryKey(e: EnrichmentSourceEntry): string {
  return e.providerId ?? e.attribution?.sourceName ?? "source";
}

function entryLabel(e: EnrichmentSourceEntry): string {
  return e.attribution?.sourceName ?? e.providerId ?? "source";
}

export function MetadataSection({
  source,
  emptyKey,
  loading,
  onOpenCredentials
}: {
  source: EnrichmentSource | null;
  emptyKey: MessageKey;
  /** True while track_detail is still in flight. A null source with
   *  loading=false is a finished miss/error - show the honest empty line,
   *  never an eternal spinner. */
  loading?: boolean;
  onOpenCredentials?: () => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (source === null) {
    return (
      <p className="contextual-empty">
        {loading === true ? t("contextual.loading") : t(emptyKey)}
      </p>
    );
  }

  const entries: EnrichmentSourceEntry[] =
    source.sources.length > 0
      ? source.sources
      : source.text !== null
        ? [
            {
              providerId: source.providerId,
              privacyClass: source.privacyClass,
              attribution: source.attribution,
              text: source.text,
              sourceUrl: source.sourceUrl
            }
          ]
        : [];

  const withText = entries.filter(
    (e) => e.text !== null && e.text.length > 0
  );

  const enhancement =
    source.enhancement !== null && onOpenCredentials !== undefined ? (
      <div className="contextual-enrich">
        {source.enhancement.reason !== null ? (
          <span className="contextual-enrich-reason">
            {source.enhancement.reason}
          </span>
        ) : null}
        <button
          type="button"
          className="trackinfo-enrich-cta"
          onClick={onOpenCredentials}
        >
          <KeyRound size={14} />
          {t("contextual.addKey", { provider: source.enhancement.provider })}
        </button>
      </div>
    ) : null;

  if (withText.length === 0) {
    return (
      <div className="contextual-pane">
        <p className="contextual-empty">{t(emptyKey)}</p>
        {enhancement}
      </div>
    );
  }

  const toggle = (k: string): void => {
    const next = new Set(hidden);
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
    }
    setHidden(next);
  };

  const visible = withText.filter((e) => !hidden.has(entryKey(e)));

  return (
    <div className="contextual-pane">
      {withText.length > 1 ? (
        <div className="source-chips">
          {withText.map((e) => {
            const k = entryKey(e);
            const on = !hidden.has(k);
            return (
              <button
                key={k}
                type="button"
                className={on ? "source-chip source-chip-on" : "source-chip"}
                aria-pressed={on}
                onClick={() => toggle(k)}
              >
                {entryLabel(e)}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="contextual-empty">{t(emptyKey)}</p>
      ) : (
        visible.map((e) => (
          <div key={entryKey(e)} className="source-block">
            <p className="contextual-text">{e.text}</p>
            <AttributionLine attribution={e.attribution} />
          </div>
        ))
      )}

      {enhancement}
    </div>
  );
}
