// Top-level shell. The screen list is the framework's admitted
// shelf set — `composition` is the source of truth; every
// admitted shelf is reachable via `#/shelf/<shelf_id>`.
//
// The component is purely a function of `runtime.composition`,
// `runtime.widgets`, and `runtime.route`. Every change to the
// admitted set, the viewport breakpoint, or the active hash
// updates the rendered tree through Preact signals without
// manual reconcile.

import { t } from "./i18n";
import { useComputed } from "@preact/signals";
import type { JSX } from "preact";

import type { Runtime } from "./boot";
import type { ResolvedShelf, ResolvedStocking } from "./composition";
import type { ShelfLayout } from "./stockings";
import { shelfHash } from "./router";
import { RuntimeContext } from "./context";
import type { WidgetProps } from "./widgets/registry";

interface ShellProps {
  runtime: Runtime;
}

export function Shell(props: ShellProps): JSX.Element {
  const composition = useComputed(() => props.runtime.composition.value);
  const route = useComputed(() => props.runtime.route.value);

  return (
    <RuntimeContext.Provider value={props.runtime}>
    <main class="evo-shell">
      <Header
        runtime={props.runtime}
        composition={composition.value}
        route={route.value}
      />
      <Body composition={composition.value} route={route.value} runtime={props.runtime} />
    </main>
    </RuntimeContext.Provider>
  );
}

function Header(props: {
  runtime: Runtime;
  composition: { readonly [id: string]: ResolvedShelf };
  route: ReturnType<Runtime["route"]["peek"]>;
}): JSX.Element {
  const shelfIds = Object.keys(props.composition).sort();
  return (
    <header class="evo-shell__header">
      <h1 class="evo-shell__title">
        <a href="#/" onClick={(e) => navTo(e, props.runtime, { kind: "root" })}>
          evo
        </a>
      </h1>
      <p class="evo-shell__subtitle">
        schema-first projection of the framework's admitted UI surface
      </p>
      <nav class="evo-shell__nav">
        {shelfIds.map((shelfId) => (
          <a
            key={shelfId}
            class={
              "evo-shell__nav-link" +
              (props.route.kind === "shelf" && props.route.shelfId === shelfId
                ? " evo-shell__nav-link--active"
                : "")
            }
            href={shelfHash(shelfId)}
            onClick={(e) =>
              navTo(e, props.runtime, { kind: "shelf", shelfId })
            }
          >
            {props.composition[shelfId].contract.label ?? shelfId}
          </a>
        ))}
      </nav>
    </header>
  );
}

function Body(props: {
  composition: { readonly [id: string]: ResolvedShelf };
  route: ReturnType<Runtime["route"]["peek"]>;
  runtime: Runtime;
}): JSX.Element {
  switch (props.route.kind) {
    case "root":
      return <RootView composition={props.composition} runtime={props.runtime} />;
    case "shelf": {
      const shelf = props.composition[props.route.shelfId];
      if (shelf === undefined) {
        return (
          <section class="evo-shell__body">
            <p class="evo-shell__missing">
              Shelf <code>{props.route.shelfId}</code> is not in the framework's
              admitted set. Navigate to <a href="#/">overview</a>.
            </p>
          </section>
        );
      }
      return <ShelfPage shelf={shelf} runtime={props.runtime} />;
    }
    case "unknown":
      return (
        <section class="evo-shell__body">
          <p class="evo-shell__missing">
            Unknown route <code>{props.route.raw}</code>. Navigate to{" "}
            <a href="#/">overview</a>.
          </p>
        </section>
      );
  }
}

function RootView(props: {
  composition: { readonly [id: string]: ResolvedShelf };
  runtime: Runtime;
}): JSX.Element {
  const shelfIds = Object.keys(props.composition).sort();
  if (shelfIds.length === 0) {
    return (
      <section class="evo-shell__body evo-shell__body--empty">
        <p>
          No admitted shelves yet. The framework's <code>describe_ui_stockings</code>{" "}
          response carried zero shelf contracts - confirm the framework's UI
          registries are populated.
        </p>
      </section>
    );
  }
  return (
    <section class="evo-shell__body evo-shell__body--overview">
      {shelfIds.map((shelfId) => (
        <ShelfCard
          key={shelfId}
          shelf={props.composition[shelfId]}
          runtime={props.runtime}
        />
      ))}
    </section>
  );
}

function ShelfCard(props: {
  shelf: ResolvedShelf;
  runtime: Runtime;
}): JSX.Element {
  const contract = props.shelf.contract;
  const admittedCount = props.shelf.stockings.filter(
    (s) => s.status.kind === "admitted",
  ).length;
  return (
    <article
      class="evo-shelf-card"
      data-shelf-id={contract.id}
      data-cardinality={contract.cardinality}
    >
      <header class="evo-shelf-card__header">
        <h2>
          <a
            href={shelfHash(contract.id)}
            onClick={(e) =>
              navTo(e, props.runtime, { kind: "shelf", shelfId: contract.id })
            }
          >
            {contract.label ?? contract.id}
          </a>
        </h2>
        <ul class="evo-shelf-card__meta">
          <li>
            <span class="evo-shelf-card__meta-label">Cardinality</span>{" "}
            <code>{contract.cardinality}</code>
          </li>
          <li>
            <span class="evo-shelf-card__meta-label">Layout</span>{" "}
            <code>{contract.layout}</code>
          </li>
          <li>
            <span class="evo-shelf-card__meta-label">Stockings</span>{" "}
            <code>{admittedCount}</code>
          </li>
        </ul>
      </header>
      {props.shelf.cardinalityViolation !== null && (
        <p class="evo-shelf-card__warning">
          {props.shelf.cardinalityViolation}
        </p>
      )}
    </article>
  );
}

function ShelfPage(props: {
  shelf: ResolvedShelf;
  runtime: Runtime;
}): JSX.Element {
  const contract = props.shelf.contract;
  return (
    <section
      class="evo-shelf-page"
      data-shelf-id={contract.id}
      data-layout={contract.layout}
    >
      <header class="evo-shelf-page__header">
        <h2 class="evo-shelf-page__title">{contract.label ?? contract.id}</h2>
        <p class="evo-shelf-page__id">
          <code>{contract.id}</code>
        </p>
        {props.shelf.cardinalityViolation !== null && (
          <p class="evo-shelf-page__warning">
            {props.shelf.cardinalityViolation}
          </p>
        )}
      </header>
      <div
        class={`evo-shelf-page__body evo-shelf-page__body--layout-${slug(
          contract.layout,
        )}`}
      >
        {props.shelf.stockings.length === 0 && (
          <p class="evo-shelf-page__empty">No admitted stockings.</p>
        )}
        {props.shelf.stockings.map((resolved) => (
          <StockingMount
            key={`${resolved.stocking.plugin}:${resolved.stocking.widgetKindId}`}
            resolved={resolved}
            layout={contract.layout}
            runtime={props.runtime}
          />
        ))}
      </div>
    </section>
  );
}

function StockingMount(props: {
  resolved: ResolvedStocking;
  layout: ShelfLayout;
  runtime: Runtime;
}): JSX.Element {
  if (props.resolved.status.kind === "refused") {
    return (
      <article class="evo-widget evo-widget--refused" data-reason={props.resolved.status.reason}>
        <header>
          <h3>{t("shell.stockingRefused")}</h3>
        </header>
        <p>
          <code>{props.resolved.stocking.plugin}</code> stocking{" "}
          <code>{props.resolved.stocking.widgetKindId}</code>{" "}
          on shelf <code>{props.resolved.stocking.shelfId}</code>:{" "}
          {props.resolved.status.reason}.
        </p>
      </article>
    );
  }
  const Component = props.runtime.widgets.lookup(
    props.resolved.stocking.widgetKindId,
  );
  if (Component === undefined) {
    return (
      <article class="evo-widget evo-widget--unknown-kind">
        <header>
          <h3>{t("shell.unknownKind")}</h3>
        </header>
        <p>
          Stocking from <code>{props.resolved.stocking.plugin}</code> declares
          widget kind <code>{props.resolved.stocking.widgetKindId}</code>,
          which is not present in the runtime's widget registry. Operator or
          plugin author should admit a matching{" "}
          <code>widget_kind_pack</code> artefact.
        </p>
      </article>
    );
  }
  const widgetProps: WidgetProps = {
    shelfId: props.resolved.stocking.shelfId,
    pluginId: props.resolved.stocking.plugin,
    stockingId: `${props.resolved.stocking.plugin}:${props.resolved.stocking.widgetKindId}`,
    widgetKindId: props.resolved.stocking.widgetKindId,
    envelope: {},
  };
  return (
    <div
      class={`evo-stocking evo-stocking--size-${props.resolved.effectiveSize}`}
      data-effective-size={props.resolved.effectiveSize}
    >
      <Component {...widgetProps} />
    </div>
  );
}

function navTo(
  e: MouseEvent,
  runtime: Runtime,
  target: Parameters<Runtime["navigate"]>[0],
): void {
  e.preventDefault();
  runtime.navigate(target);
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
