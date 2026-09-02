// Fullscreen "zoom" of the album artwork. Tapping the cover opens this;
// per the agreed concept it shows ONLY the image - fit to the window,
// centred, on black - nothing else. Tap anywhere, the close button, Esc,
// or the backdrop returns.
//
// Slideshow: `images` is the set to rotate (the current cover plus the
// artist image when the cached resolver has one). With more than one it
// cycles on a timer, fading through to each in turn, with a slow Ken
// Burns drift. When the set changes (track change) it resets to the
// first image (the new cover). Renders through the app overlay primitive
// (body portal, z-band, Esc, focus custody).

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AttentionOverlay } from "../../components/AttentionLayer";

export interface ImmersiveArtworkProps {
  onClose: () => void;
  /** URLs to rotate, most-relevant first (cover, then artist image, ...).
   *  Callers pass only the ones they actually have. */
  images: string[];
}

const SLIDE_MS = 9000;

export function ImmersiveArtwork({
  onClose,
  images
}: ImmersiveArtworkProps): JSX.Element {
  const key = images.join("|");
  const [idx, setIdx] = useState(0);

  // Reset to the first image whenever the set changes (e.g. a track
  // change swaps in a new cover).
  useEffect(() => {
    setIdx(0);
  }, [key]);

  // Advance on a timer only when there is more than one image.
  useEffect(() => {
    if (images.length < 2) return undefined;
    const id = window.setInterval(
      () => setIdx((i) => (i + 1) % images.length),
      SLIDE_MS
    );
    return () => window.clearInterval(id);
  }, [key, images.length]);

  const src =
    images.length > 0 ? images[Math.min(idx, images.length - 1)] : null;

  return (
    <AttentionOverlay
      band="dialog"
      className="evo-immersive-art"
      role="dialog"
      ariaLabel="Album artwork"
      onDismiss={onClose}
      dismissOnBackdrop
    >
      <button
        type="button"
        className="evo-immersive-close"
        aria-label="Close artwork"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        &times;
      </button>
      <div className="evo-immersive-art-stage" onClick={onClose}>
        {src !== null ? (
          <img key={src} className="evo-immersive-art-img" src={src} alt="" />
        ) : null}
      </div>
    </AttentionOverlay>
  );
}
