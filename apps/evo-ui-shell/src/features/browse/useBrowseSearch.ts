import { useCallback, useRef, useState } from "preact/hooks";
import { GatewayClient } from "../../core/gateway-client";
import type { BrowsePayload, SearchPayload } from "../../core/types";
import { t } from "../../runtime/i18n";

interface BrowseSearchState {
  browse: BrowsePayload | null;
  search: SearchPayload | null;
  loading: boolean;
  error: string | null;
}

type BrowseSearchOutcome =
  | { ok: true; result: "browse" | "search" }
  | { ok: false; error: string };

const INITIAL_STATE: BrowseSearchState = {
  browse: null,
  search: null,
  loading: false,
  error: null
};

export function useBrowseSearch(client: GatewayClient) {
  const [state, setState] = useState<BrowseSearchState>(INITIAL_STATE);
  const browseInFlightRef = useRef<Promise<BrowseSearchOutcome> | null>(null);
  const searchInFlightRef = useRef<Promise<BrowseSearchOutcome> | null>(null);

  const loadBrowse = useCallback(async (): Promise<BrowseSearchOutcome> => {
    if (browseInFlightRef.current) {
      await browseInFlightRef.current;
      return { ok: true, result: "browse" };
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const run = (async (): Promise<BrowseSearchOutcome> => {
      try {
        const browse = await client.browse();
        setState((prev) => ({ ...prev, browse, loading: false, error: null }));
        return { ok: true, result: "browse" };
      } catch (error) {
        const message = error instanceof Error ? error.message : t("browse.browseFailed");
        setState((prev) => ({
          ...prev,
          loading: false,
          error: message
        }));
        return { ok: false, error: message };
      } finally {
        browseInFlightRef.current = null;
      }
    })();

    browseInFlightRef.current = run;
    return await run;
  }, [client]);

  const loadSearch = useCallback(async (query: string): Promise<BrowseSearchOutcome> => {
    if (searchInFlightRef.current) {
      await searchInFlightRef.current;
      return { ok: true, result: "search" };
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    const run = (async (): Promise<BrowseSearchOutcome> => {
      try {
        const search = await client.search(query);
        setState((prev) => ({ ...prev, search, loading: false, error: null }));
        return { ok: true, result: "search" };
      } catch (error) {
        const message = error instanceof Error ? error.message : t("browse.searchFailed");
        setState((prev) => ({
          ...prev,
          loading: false,
          error: message
        }));
        return { ok: false, error: message };
      } finally {
        searchInFlightRef.current = null;
      }
    })();

    searchInFlightRef.current = run;
    return await run;
  }, [client]);

  return {
    ...state,
    loadBrowse,
    loadSearch
  };
}
