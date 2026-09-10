import type { LibraryBrowseFilters, LibrarySections } from "./useLibraryBrowse";

/** Sections only make sense with enough items to browse beyond highlights. */
export const MIN_ITEMS_FOR_SECTIONS = 20;

export function hasActiveLibraryFilters(filters: LibraryBrowseFilters): boolean {
  return (
    filters.typeFilter !== "all" ||
    filters.sensationFilters.length > 0 ||
    filters.search.trim().length > 0 ||
    filters.favoritesOnly ||
    filters.includeArchived
  );
}

export function prepareLibrarySections(sections: LibrarySections): {
  pinned: LibrarySections["pinned"];
  topVideo: LibrarySections["topVideo"];
  topAudio: LibrarySections["topAudio"];
  excludeIds: string[];
  visibleSectionCount: number;
} {
  const pinned = sections.pinned;
  const pinnedIds = new Set(pinned.map((i) => i.id));
  const topVideo = sections.topVideo.filter((i) => !pinnedIds.has(i.id));
  const topAudio = sections.topAudio.filter((i) => !pinnedIds.has(i.id));
  const excludeIds = [
    ...pinned.map((i) => i.id),
    ...topVideo.map((i) => i.id),
    ...topAudio.map((i) => i.id),
  ];
  return {
    pinned,
    topVideo,
    topAudio,
    excludeIds,
    visibleSectionCount: pinned.length + topVideo.length + topAudio.length,
  };
}
