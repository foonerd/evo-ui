// ComingSoonSurface - a placeholder page for a planned top-level
// feature whose framework backend has not landed yet.
//
// Used by the sidebar's Alarms and Update entries. It is an honest
// placeholder: it states the feature is planned and lists what the
// page will do, rather than presenting controls that cannot act.

import type { ComponentChildren } from "preact";

interface ComingSoonSurfaceProps {
  /** Page heading. */
  title: string;
  /** Lead sentence describing the feature. */
  lede: string;
  /** What the page will do once the framework support is in place. */
  planned: ReadonlyArray<string>;
  /** Decorative leading icon element. */
  icon: ComponentChildren;
}

export function ComingSoonSurface({
  title,
  lede,
  planned,
  icon
}: ComingSoonSurfaceProps) {
  return (
    <section className="feature-surface coming-soon">
      <header className="feature-head">
        <span className="coming-soon-icon" aria-hidden>
          {icon}
        </span>
        <div>
          <h3>{title}</h3>
          <p className="feature-description">Planned - not yet available</p>
        </div>
      </header>
      <p className="settings-placeholder-lede">{lede}</p>
      <p className="settings-placeholder-hint feature-description">
        This screen is switched on once the framework support for it
        is in place. Nothing here can be changed yet.
      </p>
      <ul className="settings-placeholder-listing">
        {planned.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
