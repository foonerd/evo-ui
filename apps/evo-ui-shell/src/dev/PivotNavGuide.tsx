import type { ComponentChildren } from "preact";

/** Explains what the live preview on the right is showing — not decorative art. */

function GuideShell({
  title,
  children
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section className="designer-preview-guide" aria-label={title}>
      <p className="designer-preview-guide-kicker">Reading the preview</p>
      <h2 className="designer-preview-guide-title">{title}</h2>
      {children}
    </section>
  );
}

/** Matches standard Home: menu + player + queue columns. */
export function FullLayoutNavGuide() {
  return (
    <GuideShell title="Three areas on screen together">
      <p className="designer-preview-guide-lead">
        Look at the device on the right. You should see the same three parts:
      </p>
      <div
        className="designer-preview-guide-map"
        role="img"
        aria-label="Menu, now playing, and queue"
      >
        <div className="designer-preview-guide-column">
          <div className="designer-preview-guide-block" />
          <span className="designer-preview-guide-label">Menu</span>
        </div>
        <div className="designer-preview-guide-column designer-preview-guide-column-main">
          <div className="designer-preview-guide-block designer-preview-guide-block-main" />
          <span className="designer-preview-guide-label">Now playing</span>
        </div>
        <div className="designer-preview-guide-column">
          <div className="designer-preview-guide-block" />
          <span className="designer-preview-guide-label">Queue</span>
        </div>
      </div>
    </GuideShell>
  );
}

/** Matches compact Home: compass default, swipe up for track. */
export function PivotNavGuide() {
  return (
    <GuideShell title="Compass first - not enough room for both">
      <p className="designer-preview-guide-lead">
        On a compact panel the home screen is the compass only. Track title,
        transport, progress and volume live on a separate sheet - swipe or tap
        up from the centre dot.
      </p>
      <ul className="designer-preview-guide-pivot">
        <li>
          <span className="designer-preview-guide-arrow" aria-hidden>
            ↑
          </span>
          Now playing (track + controls)
        </li>
        <li>
          <span className="designer-preview-guide-arrow" aria-hidden>
            ←
          </span>
          Album art
        </li>
        <li>
          <span className="designer-preview-guide-arrow" aria-hidden>
            →
          </span>
          Artist &amp; album info
        </li>
        <li>
          <span className="designer-preview-guide-arrow" aria-hidden>
            ↓
          </span>
          Library &amp; playlists
        </li>
        <li>
          <span className="designer-preview-guide-arrow" aria-hidden>
            ●
          </span>
          Tap centre for device &amp; settings
        </li>
      </ul>
      <div className="designer-preview-guide-pivot-rest" aria-hidden>
        <span className="designer-preview-guide-pivot-dot">●</span>
        <span>Default home</span>
      </div>
    </GuideShell>
  );
}
