// useFavourites - read-then-subscribe hook for audio.favourites.
// First migration onto the useShelfSubject factory (plan Phase 0b):
// the WS lifecycle, seed read, happenings subscription and verb
// dispatch plumbing live in the factory; this module keeps only
// what is favourites-specific (verbs, decoders, messages). The
// public surface is unchanged - consumers did not move.

import { useCallback } from "preact/hooks";
import {
  useShelfSubject,
  type SubjectConnectionKind,
  type SubjectConnectionState,
  type SubjectVerbResult
} from "../../runtime/use-shelf-subject";
import { t } from "../../runtime/i18n";
import {
  decodeFavouritesState,
  decodeFavouritesStateHappening,
  decodeIsFavourite,
  type FavouritesState,
  type IsFavouriteResponse
} from "./favourites-decoders";

const FAVOURITES_SHELF = "audio.favourites";

export type FavouritesConnectionKind = SubjectConnectionKind;
export type FavouritesConnectionState = SubjectConnectionState;
export type FavouritesVerbResult<T = void> = SubjectVerbResult<T>;

export interface UseFavouritesState {
  connection: FavouritesConnectionState;
  state: FavouritesState | null;
  listFavourites: () => Promise<FavouritesVerbResult<FavouritesState>>;
  isFavourite: (uri: string) => Promise<FavouritesVerbResult<IsFavouriteResponse>>;
  addFavourite: (uri: string) => Promise<FavouritesVerbResult>;
  removeFavourite: (uri: string) => Promise<FavouritesVerbResult>;
  clearFavourites: () => Promise<FavouritesVerbResult>;
  moveFavourite: (uri: string, toPosition: number) => Promise<FavouritesVerbResult>;
}

export function useFavourites(): UseFavouritesState {
  const subject = useShelfSubject<FavouritesState>({
    shelf: FAVOURITES_SHELF,
    readRequestType: "favourites.list_favourites",
    decodeRead: decodeFavouritesState,
    decodeHappening: decodeFavouritesStateHappening,
    messages: {
      wsUnavailable: () => t("collection.wsUnavailable"),
      notConnected: () => t("fav.notConnected"),
      noResponse: (n, detail) => t("fav.noResponse", { n, detail }),
      refused: () => t("fav.refusedCommand")
    }
  });
  const { setState, dispatchVoid, request } = subject;

  const listFavourites = useCallback(async (): Promise<
    FavouritesVerbResult<FavouritesState>
  > => {
    const result = await request(
      "favourites.list_favourites",
      {},
      decodeFavouritesState,
      () => t("fav.unrecognisedList")
    );
    if (result.ok) setState(result.value);
    return result;
  }, [request, setState]);

  const isFavourite = useCallback(
    (uri: string) =>
      request(
        "favourites.is_favourite",
        { uri },
        decodeIsFavourite,
        () => t("fav.unrecognisedIsFavourite")
      ),
    [request]
  );

  const addFavourite = useCallback(
    (uri: string) => dispatchVoid("favourites.add_favourite", { uri }),
    [dispatchVoid]
  );
  const removeFavourite = useCallback(
    (uri: string) => dispatchVoid("favourites.remove_favourite", { uri }),
    [dispatchVoid]
  );
  const clearFavourites = useCallback(
    () => dispatchVoid("favourites.clear_favourites", {}),
    [dispatchVoid]
  );
  const moveFavourite = useCallback(
    (uri: string, toPosition: number) =>
      dispatchVoid("favourites.move_favourite", { uri, to_position: toPosition }),
    [dispatchVoid]
  );

  return {
    connection: subject.connection,
    state: subject.state,
    listFavourites,
    isFavourite,
    addFavourite,
    removeFavourite,
    clearFavourites,
    moveFavourite
  };
}
