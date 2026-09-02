// Standalone metadata widget - one placeable card per section (artist bio,
// album notes, lyrics, provenance). Each pulls the shared track_detail for
// the now-playing track and composes the same renderers the combined
// surface uses, so an operator can drop just a bio, or just lyrics, wherever
// they want on a page.

import { useLocale } from "../../runtime/use-locale";
import { t } from "../../runtime/i18n";
import type { MessageKey } from "../../locales/en";
import { useTrackDetail } from "./use-track-detail";
import { MetadataSection } from "./MetadataSection";
import { LyricsBlock } from "./LyricsBlock";
import { ProvenanceBlock, hasProvenance } from "./ProvenanceBlock";
import type { NowPlaying } from "./now-playing-decoders";

export type MetadataWidgetSection = "bio" | "album" | "lyrics" | "provenance";

const TITLE: Record<MetadataWidgetSection, MessageKey> = {
  bio: "contextual.tab.artist",
  album: "contextual.tab.album",
  lyrics: "contextual.tab.lyrics",
  provenance: "metawidget.provenance"
};

export function MetadataWidget({
  nowPlaying,
  section,
  onOpenCredentials
}: {
  nowPlaying: NowPlaying | null;
  section: MetadataWidgetSection;
  onOpenCredentials: () => void;
}) {
  useLocale();
  const track = nowPlaying?.track ?? null;
  const { detail, phase } = useTrackDetail(track?.mpdPath ?? null);
  const loading = phase === "loading";

  let body: preact.ComponentChildren;
  if (track === null) {
    body = <p className="feature-description">{t("trackinfo.nothing")}</p>;
  } else if (section === "bio") {
    body = (
      <MetadataSection
        source={detail?.artistBio ?? null}
        emptyKey="contextual.noBio"
        loading={loading}
        onOpenCredentials={onOpenCredentials}
      />
    );
  } else if (section === "album") {
    body = (
      <MetadataSection
        source={detail?.albumNotes ?? null}
        emptyKey="contextual.noNotes"
        loading={loading}
        onOpenCredentials={onOpenCredentials}
      />
    );
  } else if (section === "lyrics") {
    body = <LyricsBlock detail={detail} loading={loading} />;
  } else {
    const rec = detail?.reconciliation ?? null;
    body = hasProvenance(rec) ? (
      <ProvenanceBlock reconciliation={rec} />
    ) : (
      <p className="contextual-empty">{t("contextual.noProvenance")}</p>
    );
  }

  return (
    <section className="card feature-surface">
      <div className="feature-head">
        <div>
          <h3>{t(TITLE[section])}</h3>
        </div>
      </div>
      {body}
    </section>
  );
}
