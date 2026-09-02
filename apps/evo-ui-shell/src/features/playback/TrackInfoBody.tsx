// Chrome-less Track Info body - provenance chips, the Artist/Album/Lyrics
// (+ classical Work) tabs, and the tab panes. Shared by the page card
// (TrackInfoSurface wraps this in card chrome + a title head) and the
// stage "tabbed" atom (mounts it bare inside a cell). Presentational: it
// takes the already-fetched track_detail + loading, never fetches itself,
// so a stage owns a single track_detail read.

import { useMemo, useState } from "preact/hooks";
import { t } from "../../runtime/i18n";
import type { MessageKey } from "../../locales/en";
import { MetadataSection } from "./MetadataSection";
import { LyricsBlock } from "./LyricsBlock";
import { ProvenanceBlock, hasProvenance } from "./ProvenanceBlock";
import type { TrackDetail } from "./track-detail-decoders";
import type { NowPlaying } from "./now-playing-decoders";

type ClassicalTags = NonNullable<NowPlaying["track"]>["classical"];
type TabId = "artist" | "album" | "lyrics" | "work";

const TAB_LABEL: Record<TabId, MessageKey> = {
  artist: "contextual.tab.artist",
  album: "contextual.tab.album",
  lyrics: "contextual.tab.lyrics",
  work: "contextual.tab.work"
};

export function TrackInfoBody({
  classical,
  detail,
  loading,
  onOpenCredentials
}: {
  classical: ClassicalTags;
  detail: TrackDetail | null;
  loading: boolean;
  onOpenCredentials: () => void;
}) {
  const isClassical = classical != null;
  const tabs = useMemo<TabId[]>(() => {
    const list: TabId[] = ["artist", "album", "lyrics"];
    if (isClassical) list.push("work");
    return list;
  }, [isClassical]);
  const [rawTab, setTab] = useState<TabId>("artist");
  const tab = tabs.includes(rawTab) ? rawTab : tabs[0];
  const rec = detail?.reconciliation ?? null;

  return (
    <div className="trackinfo-body">
      {hasProvenance(rec) ? <ProvenanceBlock reconciliation={rec} /> : null}

      <div className="contextual-tabs" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={
              tab === id
                ? "contextual-tab contextual-tab-active"
                : "contextual-tab"
            }
            onClick={() => setTab(id)}
          >
            {t(TAB_LABEL[id])}
          </button>
        ))}
      </div>

      <div className="contextual-body" role="tabpanel">
        {tab === "artist" ? (
          <MetadataSection
            source={detail?.artistBio ?? null}
            emptyKey="contextual.noBio"
            loading={loading}
            onOpenCredentials={onOpenCredentials}
          />
        ) : null}
        {tab === "album" ? (
          <MetadataSection
            source={detail?.albumNotes ?? null}
            emptyKey="contextual.noNotes"
            loading={loading}
            onOpenCredentials={onOpenCredentials}
          />
        ) : null}
        {tab === "lyrics" ? (
          <LyricsBlock detail={detail} loading={loading} />
        ) : null}
        {tab === "work" ? <WorkPane classical={classical} /> : null}
      </div>
    </div>
  );
}

function WorkRow({ label, value }: { label: MessageKey; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="contextual-work-row">
      <span className="contextual-work-label">{t(label)}</span>
      <span className="contextual-work-value">{value}</span>
    </div>
  );
}

export function WorkPane({ classical }: { classical: ClassicalTags }) {
  if (classical === null) {
    return <p className="contextual-empty">{t("contextual.noWork")}</p>;
  }
  return (
    <div className="contextual-pane contextual-work">
      <WorkRow label="contextual.work.composer" value={classical.composer} />
      <WorkRow label="contextual.work.work" value={classical.work} />
      <WorkRow label="contextual.work.movement" value={classical.movement} />
      <WorkRow label="contextual.work.conductor" value={classical.conductor} />
      <WorkRow label="contextual.work.ensemble" value={classical.ensemble} />
      <WorkRow label="contextual.work.performer" value={classical.performer} />
    </div>
  );
}
