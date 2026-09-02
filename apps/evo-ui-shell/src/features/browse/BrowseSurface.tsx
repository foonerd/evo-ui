import { useEffect, useState } from "preact/hooks";
import { CapabilityGate } from "../../app/components/CapabilityGate";
import type { CapabilityStatus, UiEventFrame } from "../../core/types";
import { GatewayClient } from "../../core/gateway-client";
import { useBrowseSearch } from "./useBrowseSearch";
import { shouldReconcileFromEvent } from "../../core/reconcile-policy";
import { runCommandAction } from "../../core/command-action";
import { useAsyncAction } from "../../core/useAsyncAction";
import type { NewCommandLogEntry } from "../../core/command-log";
import { combineCapabilityStatuses } from "../../core/capability-status";
import { shouldRefreshFromAnomaly } from "../../core/anomaly-refresh";
import { canRunSearch, normalizeSearchQuery } from "../../core/search-query";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

interface BrowseSurfaceProps {
  browseStatus: CapabilityStatus;
  searchStatus: CapabilityStatus;
  client: GatewayClient;
  lastEvent: UiEventFrame | null;
  streamOpen: boolean;
  anomalySignal: number;
  runInFlight: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
  onCommandLog: (entry: NewCommandLogEntry) => void;
}

export function BrowseSurface({
  browseStatus,
  searchStatus,
  client,
  lastEvent,
  streamOpen,
  anomalySignal,
  runInFlight,
  onCommandLog
}: BrowseSurfaceProps) {
  useLocale();
  const status = combineCapabilityStatuses([browseStatus, searchStatus]);
  const { browse, search, loading, error, loadBrowse, loadSearch } = useBrowseSearch(client);
  const action = useAsyncAction();
  const [searchQuery, setSearchQuery] = useState("evo");
  const normalizedSearchQuery = normalizeSearchQuery(searchQuery);

  useEffect(() => {
    if (browseStatus !== "missing") {
      void loadBrowse();
    }
  }, [browseStatus, loadBrowse]);

  useEffect(() => {
    if (shouldReconcileFromEvent("browse", lastEvent) && browseStatus !== "missing") {
      void loadBrowse();
    }
  }, [lastEvent, loadBrowse, browseStatus]);

  useEffect(() => {
    if (shouldRefreshFromAnomaly(anomalySignal, browseStatus)) {
      void loadBrowse();
    }
  }, [anomalySignal, browseStatus, loadBrowse]);

  return (
    <CapabilityGate
      title={t("browse.title")}
      status={status}
      description={t("browse.description")}
      partialHint={t("browse.partialHint")}
    >
      <div className="browse-grid">
        <div className="queue-state">
          <strong>{t("browse.browseLabel")}</strong> {browseStatus}
        </div>
        <div className="queue-state">
          <strong>{t("browse.searchLabel")}</strong> {searchStatus}
        </div>
      </div>
      <div className="action-row">
        <button
          type="button"
          disabled={browseStatus === "missing" || loading || action.loading}
          onClick={() => {
            void (async () => {
              await runCommandAction({
                domain: "browse",
                action: "refresh",
                execute: () =>
                  action.run(
                    () => runInFlight("browse:refresh", () => loadBrowse()),
                    t("browse.snapshotLoaded")
                  ),
                toSuccessDetail: () => t("browse.snapshotLoaded"),
                onCommandLog
              });
            })();
          }}
        >
          {t("browse.openLibrary")}
        </button>
        <button
          type="button"
          disabled={
            searchStatus === "missing" || loading || action.loading || !canRunSearch(searchQuery)
          }
          onClick={() => {
            void (async () => {
              await runCommandAction({
                domain: "browse",
                action: "search",
                execute: () =>
                  action.run(
                    () => runInFlight("browse:search", () => loadSearch(normalizedSearchQuery)),
                    () => t("browse.searchCompleted", { query: normalizedSearchQuery })
                  ),
                toSuccessDetail: () =>
                  t("browse.searchCompleted", { query: normalizedSearchQuery }),
                onCommandLog
              });
            })();
          }}
        >
          {t("browse.search")}
        </button>
      </div>
      <div className="action-row">
        <label>
          {t("browse.query")}{" "}
          <input
            type="text"
            value={searchQuery}
            onInput={(event) =>
              setSearchQuery((event.currentTarget as HTMLInputElement).value)
            }
            placeholder={t("browse.searchTermPlaceholder")}
          />
        </label>
      </div>
      {!streamOpen ? (
        <p className="feature-hint">{t("browse.streamStale")}</p>
      ) : null}
      {error ? <p className="feature-hint">{error}</p> : null}
      {action.error ? <p className="feature-hint">{action.error}</p> : null}
      {action.successMessage ? <p className="feature-success">{action.successMessage}</p> : null}
      {browse?.items?.length ? (
        <ul className="simple-list">
          {browse.items.slice(0, 5).map((item) => (
            <li key={item.uri}>{item.title}</li>
          ))}
        </ul>
      ) : null}
      {search?.items?.length ? (
        <ul className="simple-list">
          {search.items.slice(0, 5).map((item) => (
            <li key={item.uri}>{item.title}</li>
          ))}
        </ul>
      ) : null}
    </CapabilityGate>
  );
}
