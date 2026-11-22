// SoftwareUpdateSurface - the Software update view.
//
// Opening it runs the update-source check (useSoftwareUpdate): an audio
// registry already there is the operator's channel and is named here;
// with none, the device registers evo-audio-prod through the one step-up
// card, and the outcome - registered, cancelled or refused - stays on this
// view. The channel is which registry is registered; there is no picker
// here.

import { DownloadCloud } from "lucide-preact";
import { useSoftwareUpdate, type UpdatePhase } from "./useSoftwareUpdate";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

function phaseLine(phase: UpdatePhase): string {
  switch (phase.kind) {
    case "checking":
      return t("update.checking");
    case "present":
      return t("update.present", { slugs: phase.slugs.join(", ") });
    case "listFailed":
      return t("update.listFailed", { message: phase.message });
    case "noTriple":
      return t("update.noTriple", { architecture: phase.architecture ?? t("settings.unknown") });
    case "registering":
      return t("update.registering");
    case "registered":
      return t("update.registered", { slug: phase.slug });
    case "refused":
      return t("update.refused", { message: phase.message });
  }
}

export function SoftwareUpdateSurface() {
  useLocale();
  const { phase } = useSoftwareUpdate();
  const failed = phase.kind === "listFailed" || phase.kind === "noTriple" || phase.kind === "refused";
  return (
    <section className="feature-surface">
      <header className="feature-head">
        <span className="coming-soon-icon" aria-hidden>
          <DownloadCloud size={20} />
        </span>
        <div>
          <h3>{t("update.title")}</h3>
          <p className="feature-description">{t("update.lede")}</p>
        </div>
      </header>
      <p className="feature-description" role={failed ? "alert" : "status"}>
        {phaseLine(phase)}
      </p>
      <p className="feature-description settings-help">{t("update.channelNote")}</p>
    </section>
  );
}
