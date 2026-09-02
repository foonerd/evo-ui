// Mode-aware source attribution, shared by every metadata renderer.
// Renders link | qr | name per the global attribution mode. The source
// name and license always show - credit is never suppressed; only the
// navigation form changes, so the kiosk is never stranded by a link.

import { ExternalLink } from "lucide-preact";
import { t } from "../../runtime/i18n";
import { attributionMode } from "./attribution-mode";
import { QrCode } from "./QrCode";
import type { SourceAttribution } from "./track-detail-decoders";

export function AttributionLine({
  attribution
}: {
  attribution: SourceAttribution | null;
}) {
  if (attribution === null) return null;
  const a = attribution;
  const url = a.sourceUrl;
  const mode = attributionMode();
  return (
    <div className="contextual-attribution">
      <p>
        {t("contextual.source", { name: a.sourceName })}
        {mode === "link" && url !== null ? (
          <>
            {" "}
            <a
              className="contextual-source-link"
              href={url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={12} />
              {t("contextual.viewOn", { name: a.sourceName })}
            </a>
          </>
        ) : null}
      </p>
      {mode === "qr" && url !== null ? (
        <div className="contextual-qr">
          <QrCode url={url} />
        </div>
      ) : null}
    </div>
  );
}
