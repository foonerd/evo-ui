// PivotBioReveal - the compass "bio" act. Formerly a static
// placeholder; now the live smart-metadata crawl (the same seamless
// ambient scroll used by the smart page widget and the stage smart
// atom), fed from the now-playing track. The artist header comes from
// now_playing; the crawl body self-fetches track_detail and cycles the
// sections that have content (bio / album notes / lyrics / provenance),
// each with inline attribution. Honest states: nothing playing, loading,
// or an explicit no-metadata - never a permanent spinner.

import { usePlayback } from "../playback/usePlayback";
import { useTrackDetail } from "../playback/use-track-detail";
import { SmartCrawl } from "../playback/SmartMetadataWidget";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function PivotBioReveal() {
  useLocale();
  const { nowPlaying } = usePlayback();
  const track = nowPlaying?.track ?? null;
  const { detail, phase } = useTrackDetail(track?.mpdPath ?? null);

  return (
    <div className="pivot-bio pivot-bio-scroll">
      <p className="nav-group-title">{t("pivot.bio.artist")}</p>
      <h3 className="context-name" title={track?.artist ?? ""}>
        {track?.artist ?? t("stage.nothingPlaying")}
      </h3>
      <SmartCrawl nowPlaying={nowPlaying} detail={detail} phase={phase} />
    </div>
  );
}
