// PivotArtReveal - the swipe-left now-playing CANVAS (compact model,
// accepted 2026-06-08). A square cover on one side over an ambient
// field; the residual space the square does not use carries the
// provenance (codec badge + rate/bit-depth/bitrate) and the
// favourite + add-to-playlist actions. Landscape puts the residual in
// the gutter beside the cover; portrait puts it in the band below.
// No album-art source -> a calm disc placeholder (the honest
// miss-policy floor: never show fabricated content; surface the
// missing-source state directly). Cover image comes from
// now_playing's artwork_url.

import { useEffect, useMemo, useState } from "preact/hooks";
import { Disc3, Heart, ListPlus } from "lucide-preact";
import { usePlayback } from "../playback/usePlayback";
import { useFavourites } from "../favourites/useFavourites";
import { usePlaylists } from "../playlist/usePlaylists";
import { usePresentationPlan } from "../../runtime/presentation-context";
import { codecBadge, provenanceDetail } from "../playback/provenance";
import { PlaylistPickerDialog } from "../../components/dialogs";
import { t } from "../../runtime/i18n";
import { HeartbeatMark } from "../../components/HeartbeatMark";
import { useLocale } from "../../runtime/use-locale";

type VerbResult = { ok: true } | { ok: false; message: string };

export function PivotArtReveal() {
  useLocale();
  const { nowPlaying, streamFormat } = usePlayback();
  const favourites = useFavourites();
  const playlists = usePlaylists();
  const plan = usePresentationPlan();

  const track = nowPlaying?.track ?? null;
  const uri = track?.mpdPath ?? null;
  const artworkUrl = track?.artworkUrl ?? null;

  const [imgFailed, setImgFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // A new artwork URL is a fresh chance to load - clear any prior error.
  useEffect(() => {
    setImgFailed(false);
  }, [artworkUrl]);

  const favouriteUris = useMemo(() => {
    const s = new Set<string>();
    favourites.state?.items.forEach((i) => s.add(i.uri));
    return s;
  }, [favourites.state]);

  const badge = codecBadge(streamFormat);
  const detail = provenanceDetail(streamFormat);
  const isFav = uri !== null && favouriteUris.has(uri);
  const showCover = artworkUrl !== null && !imgFailed;
  const landscape = plan.effectiveW >= plan.effectiveH;

  const run = async (verb: () => Promise<VerbResult>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const r = await verb();
      if (!r.ok) setFeedback(r.message);
    } finally {
      setBusy(false);
    }
  };

  const toMsg = (r: { ok: true; value?: unknown } | { ok: false; message: string }): VerbResult =>
    r.ok ? { ok: true } : { ok: false, message: r.message };

  return (
    <div
      className={
        landscape ? "pivot-art pivot-art-landscape" : "pivot-art pivot-art-portrait"
      }
    >
      <div className="pivot-art-cover">
        {showCover ? (
          <img
            key={artworkUrl as string}
            src={artworkUrl as string}
            alt=""
            className="pivot-art-img"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="pivot-art-disc" aria-hidden>
            <HeartbeatMark size="sm" />
          </div>
        )}
      </div>

      <div className="pivot-art-residual">
        <div className="pivot-art-meta">
          <h3 className="pivot-art-title" title={track?.title ?? ""}>
            {track !== null
              ? track.title ?? t("pivot.art.unknownTrack")
              : t("stage.nothingPlaying")}
          </h3>
          {track?.artist ? (
            <p className="pivot-art-artist" title={track.artist}>
              {track.artist}
            </p>
          ) : null}
          {track?.album ? (
            <p className="pivot-art-album" title={track.album}>
              {track.album}
            </p>
          ) : null}
        </div>

        {badge !== null || detail !== null ? (
          <div className="pivot-art-provenance">
            {badge !== null ? (
              <span className="pivot-art-codec">{badge}</span>
            ) : null}
            {detail !== null ? (
              <span className="pivot-art-format">{detail}</span>
            ) : null}
          </div>
        ) : null}

        {track !== null && uri !== null ? (
          <div className="pivot-art-actions">
            <button
              type="button"
              className={
                isFav
                  ? "pivot-art-action pivot-art-action-on"
                  : "pivot-art-action"
              }
              disabled={busy}
              aria-pressed={isFav}
              aria-label={
                isFav
                  ? t("collection.removeFromFavourites")
                  : t("collection.addToFavourites")
              }
              onClick={() =>
                void run(() =>
                  (isFav
                    ? favourites.removeFavourite(uri)
                    : favourites.addFavourite(uri)
                  ).then(toMsg)
                )
              }
            >
              <Heart size={18} fill={isFav ? "currentColor" : "none"} />
              <span>
                {isFav ? t("pivot.art.favourited") : t("pivot.art.favourite")}
              </span>
            </button>
            <button
              type="button"
              className="pivot-art-action"
              disabled={busy}
              aria-label={t("collection.addToPlaylist")}
              onClick={() => setAddOpen(true)}
            >
              <ListPlus size={18} />
              <span>{t("queue.addToList")}</span>
            </button>
          </div>
        ) : null}

        {feedback ? (
          <p className="pivot-art-feedback" role="status">
            {feedback}
          </p>
        ) : null}
      </div>

      {addOpen && uri !== null ? (
        <PlaylistPickerDialog
          title={t("collection.addToPlaylist")}
          hint={t("pivot.art.appendHint")}
          playlists={playlists.index?.playlists ?? []}
          confirmLabel={t("dialog.add")}
          onCancel={() => setAddOpen(false)}
          onConfirm={(name) => {
            setAddOpen(false);
            void run(() => playlists.addToPlaylist(name, [uri]).then(toMsg));
          }}
        />
      ) : null}
    </div>
  );
}
