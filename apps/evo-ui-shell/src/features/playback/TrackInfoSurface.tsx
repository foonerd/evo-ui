// CONTEXTUAL INFO widget (page card) - details about the currently-playing
// track. Page chrome only: it fetches the composite track_detail and wraps
// the shared, chrome-less TrackInfoBody in a card with a title head. The
// same body mounts bare as the stage "tabbed" atom, so stage and page
// render identical content from one code path.

import { useLocale } from "../../runtime/use-locale";
import { t } from "../../runtime/i18n";
import { useTrackDetail } from "./use-track-detail";
import { TrackInfoBody } from "./TrackInfoBody";
import type { NowPlaying } from "./now-playing-decoders";

interface TrackInfoSurfaceProps {
  nowPlaying: NowPlaying | null;
  onOpenCredentials: () => void;
}

export function TrackInfoSurface({
  nowPlaying,
  onOpenCredentials
}: TrackInfoSurfaceProps) {
  useLocale();
  const track = nowPlaying?.track ?? null;
  const { detail, phase } = useTrackDetail(track?.mpdPath ?? null);

  if (track === null) {
    return (
      <section className="card feature-surface">
        <div className="feature-head">
          <div>
            <h3>{t("trackinfo.title")}</h3>
          </div>
        </div>
        <p className="feature-description">{t("trackinfo.nothing")}</p>
      </section>
    );
  }

  return (
    <section className="card feature-surface">
      <div className="feature-head">
        <div>
          <h3>{track.title ?? t("stage.untitled")}</h3>
          {track.artist !== null ? (
            <p className="feature-description">
              {track.artist}
              {track.album !== null ? ` - ${track.album}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <TrackInfoBody
        classical={track.classical}
        detail={detail}
        loading={phase === "loading"}
        onOpenCredentials={onOpenCredentials}
      />
    </section>
  );
}
