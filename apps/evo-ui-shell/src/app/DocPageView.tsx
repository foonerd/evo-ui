// Document page renderer. Takes one resolved page from the layout
// document (runtime/layout-document.ts resolveLayout) and paints its
// regions: `main` as a 12-column grid with per-slot column spans,
// `rail` as a narrow side column, `deck` as a bottom strip. The
// actual widget bodies come from the `renderWidget` closure App.tsx
// supplies — this component owns layout mechanics only.
//
// Status posture on the display surface: `admitted` slots render;
// `unavailable` slots (withdrawn availability) are skipped silently —
// the arrangement survives a plugin round trip; `refused` slots are
// skipped but stamped in a data attribute for diagnosis. The designer
// is the surface that visualises ghosts and refusals, not the device.

import type { JSX } from "preact";

import {
  shedAtTier,
  type PageRegionId,
  type ResolvedPage,
  type ResolvedSlot,
} from "../runtime/layout-document";
import { APP_CONTRACT_KINDS } from "./widget-catalog";
import type { UiSize } from "../runtime/stockings";

const MAIN_SPAN: Record<UiSize, number> = {
  atom: 2,
  quarter: 3,
  third: 4,
  half: 6,
  "two-thirds": 8,
  full: 12,
};

/**
 * Grid placement for a slot on the 12-column main region. `auto`
 * flows with neighbours; left/center/right pin the column start -
 * the mockup-v3 alignment contract, shared by the device renderer
 * and the designer build canvas.
 */
export function gridColumnFor(
  size: UiSize,
  align: "auto" | "left" | "center" | "right" | undefined,
): string {
  const span = MAIN_SPAN[size] ?? 6;
  switch (align) {
    case "left":
      return `1 / span ${span}`;
    case "center":
      return `${Math.floor((12 - span) / 2) + 1} / span ${span}`;
    case "right":
      return `${13 - span} / span ${span}`;
    default:
      return `span ${span}`;
  }
}

export interface DocPageViewProps {
  readonly page: ResolvedPage;
  readonly renderWidget: (
    widgetKindId: string,
    slotKey: string,
  ) => JSX.Element | null;
  /** Fold-tier shedding floor (foldMinPriority of the active tier).
   *  Slots below it fold away; default 1 shows everything. */
  readonly minFoldPriority?: number;
}

export function DocPageView(props: DocPageViewProps): JSX.Element {
  const min = props.minFoldPriority ?? 1;
  // Contract kinds (the centre stage) never shed, whatever priority
  // a document carries - the fold model's region order is law.
  const fold = (slots: readonly ResolvedSlot[]) =>
    shedAtTier(slots, min, APP_CONTRACT_KINDS).visible;
  const main = fold(props.page.regions.main ?? []);
  const railPosition = props.page.page.railPosition ?? "right";
  // "off" hides the rail without touching its widgets. The rail's
  // region chrome (divider + spacing) must only appear when something
  // actually RENDERS: unavailable/refused slots draw nothing, so an
  // all-ghost rail must not leave a framed empty strip on the glass.
  const rail = (
    railPosition === "off" ? [] : fold(props.page.regions.rail ?? [])
  ).filter((slot) => slot.status.kind === "admitted");
  const deck = fold(props.page.regions.deck ?? []);
  const refusedCount = countRefused(props.page);
  return (
    <section
      className="doc-page"
      data-doc-page={props.page.page.id}
      data-refused-slots={refusedCount > 0 ? refusedCount : undefined}
    >
      <div
        className={
          rail.length > 0
            ? `doc-page-body doc-page-body-railed doc-page-body-rail-${railPosition}`
            : "doc-page-body"
        }
      >
        <div className="doc-page-main">
          {main.map((slot, i) => (
            <Slot
              key={slotKey("main", slot, i)}
              slot={slot}
              region="main"
              slotId={slotKey("main", slot, i)}
              renderWidget={props.renderWidget}
            />
          ))}
        </div>
        {rail.length > 0 ? (
          <div
            className="doc-page-rail"
            style={
              props.page.page.railOpacity !== undefined
                ? { "--rail-bg-alpha": String(props.page.page.railOpacity) }
                : undefined
            }
          >
            {rail.map((slot, i) => (
              <Slot
                key={slotKey("rail", slot, i)}
                slot={slot}
                region="rail"
                slotId={slotKey("rail", slot, i)}
                renderWidget={props.renderWidget}
              />
            ))}
          </div>
        ) : null}
      </div>
      {deck.length > 0 ? (
        <div className="doc-page-deck">
          {deck.map((slot, i) => (
            <Slot
              key={slotKey("deck", slot, i)}
              slot={slot}
              region="deck"
              slotId={slotKey("deck", slot, i)}
              renderWidget={props.renderWidget}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Slot(props: {
  slot: ResolvedSlot;
  region: PageRegionId;
  slotId: string;
  renderWidget: DocPageViewProps["renderWidget"];
}): JSX.Element | null {
  const { slot, region } = props;
  if (slot.status.kind !== "admitted") {
    return null;
  }
  const body = props.renderWidget(slot.slot.widgetKindId, props.slotId);
  if (body === null) {
    return null;
  }
  const style =
    region === "main"
      ? { gridColumn: gridColumnFor(slot.effectiveSize, slot.slot.widgetKindId === "evo.app.nowplaying" ? "center" : slot.slot.align) }
      : undefined;
  return (
    <div
      className={`doc-slot doc-slot-${region} doc-slot-size-${slot.effectiveSize}`}
      style={style}
      data-widget-kind={slot.slot.widgetKindId}
      data-effective-size={slot.effectiveSize}
    >
      {body}
    </div>
  );
}

function slotKey(region: string, slot: ResolvedSlot, index: number): string {
  return `${region}:${slot.slot.widgetKindId}:${index}`;
}

function countRefused(page: ResolvedPage): number {
  let n = 0;
  for (const region of ["main", "rail", "deck"] as const) {
    for (const slot of page.regions[region] ?? []) {
      if (slot.status.kind === "refused") n += 1;
    }
  }
  return n;
}
