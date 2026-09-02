import type { QueueSnapshotPayload } from "./types";

export function removeCurrentItem(
  snapshot: QueueSnapshotPayload
): QueueSnapshotPayload {
  if (snapshot.items.length === 0) {
    return snapshot;
  }

  const currentIndex = snapshot.current_index ?? 0;
  const items = snapshot.items.filter((_, idx) => idx !== currentIndex);
  const nextCurrentIndex =
    items.length === 0
      ? null
      : currentIndex >= items.length
        ? items.length - 1
        : currentIndex;

  return {
    ...snapshot,
    items,
    current_index: nextCurrentIndex
  };
}

export function moveCurrentItemNext(
  snapshot: QueueSnapshotPayload
): QueueSnapshotPayload {
  if (snapshot.items.length < 2) {
    return snapshot;
  }

  const currentIndex = snapshot.current_index ?? 0;
  const nextIndex = Math.min(currentIndex + 1, snapshot.items.length - 1);
  const items = [...snapshot.items];
  const [moved] = items.splice(currentIndex, 1);
  items.splice(nextIndex, 0, moved);

  return {
    ...snapshot,
    items,
    current_index: nextIndex
  };
}
