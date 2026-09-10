"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browseEffectLibrary,
  fetchLibrarySections,
  type EffectLibraryCard,
  type LibraryBrowseSort,
} from "../../lib/api";
import type { LibraryTypeFilter } from "../../lib/libraryUtils";
import {
  hasActiveLibraryFilters,
  MIN_ITEMS_FOR_SECTIONS,
  prepareLibrarySections,
} from "./libraryBrowseUtils";

const PAGE_SIZE = 48;

export type LibrarySections = {
  pinned: EffectLibraryCard[];
  topVideo: EffectLibraryCard[];
  topAudio: EffectLibraryCard[];
};

export type LibraryBrowseFilters = {
  search: string;
  typeFilter: LibraryTypeFilter;
  sensationFilters: string[];
  favoritesOnly: boolean;
  includeArchived: boolean;
  sort: LibraryBrowseSort;
};

const DEFAULT_FILTERS: LibraryBrowseFilters = {
  search: "",
  typeFilter: "all",
  sensationFilters: [],
  favoritesOnly: false,
  includeArchived: false,
  sort: "mostUsed",
};

function browseParams(
  filters: LibraryBrowseFilters,
  excludeIds?: string[]
) {
  return {
    type: filters.typeFilter === "all" ? undefined : filters.typeFilter,
    search: filters.search.trim() || undefined,
    sensationTags:
      filters.sensationFilters.length > 0
        ? filters.sensationFilters
        : undefined,
    favorite: filters.favoritesOnly || undefined,
    includeArchived: filters.includeArchived || undefined,
    sort: filters.sort,
    excludeIds: excludeIds?.length ? excludeIds : undefined,
  };
}

export function useLibraryBrowse(
  refreshToken = 0,
  enableSections = true
) {
  const [filters, setFilters] = useState<LibraryBrowseFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<EffectLibraryCard[]>([]);
  const [total, setTotal] = useState(0);
  const [sections, setSections] = useState<LibrarySections>({
    pinned: [],
    topVideo: [],
    topAudio: [],
  });
  const [sectionMeta, setSectionMeta] = useState({
    show: false,
    visibleCount: 0,
    excludeIds: [] as string[],
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const excludeIdsRef = useRef<string[]>([]);

  const reloadFromStart = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setInitialLoading(true);
    setLoadingMore(false);
    setError("");

    const filtersActive = hasActiveLibraryFilters(filters);

    try {
      let excludeIds: string[] = [];
      let showSections = false;
      let preparedSections = {
        pinned: [] as EffectLibraryCard[],
        topVideo: [] as EffectLibraryCard[],
        topAudio: [] as EffectLibraryCard[],
        visibleSectionCount: 0,
      };

      if (!filtersActive && enableSections) {
        const countProbe = await browseEffectLibrary({
          ...browseParams(filters),
          limit: 1,
          offset: 0,
        });
        if (reqId !== requestIdRef.current) return;

        if (countProbe.total >= MIN_ITEMS_FOR_SECTIONS) {
          const raw = await fetchLibrarySections();
          if (reqId !== requestIdRef.current) return;
          const prepared = prepareLibrarySections(raw);
          preparedSections = prepared;
          excludeIds = prepared.excludeIds;
          showSections = prepared.visibleSectionCount > 0;
        }
      }

      excludeIdsRef.current = showSections ? excludeIds : [];
      setSections({
        pinned: showSections ? preparedSections.pinned : [],
        topVideo: showSections ? preparedSections.topVideo : [],
        topAudio: showSections ? preparedSections.topAudio : [],
      });
      setSectionMeta({
        show: showSections,
        visibleCount: showSections ? preparedSections.visibleSectionCount : 0,
        excludeIds: showSections ? excludeIds : [],
      });

      const result = await browseEffectLibrary({
        ...browseParams(filters, showSections ? excludeIds : undefined),
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (reqId !== requestIdRef.current) return;

      setTotal(result.total);
      setItems(result.items);
    } catch (e) {
      if (reqId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : String(e));
        setItems([]);
        setTotal(0);
        setSections({ pinned: [], topVideo: [], topAudio: [] });
        setSectionMeta({ show: false, visibleCount: 0, excludeIds: [] });
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setInitialLoading(false);
      }
    }
  }, [filters, enableSections]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void reloadFromStart();
    }, filters.search ? 250 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, reloadFromStart, refreshToken]);

  const loadMore = useCallback(async () => {
    if (loadingMore || initialLoading || items.length >= total) return;
    const reqId = ++requestIdRef.current;
    setLoadingMore(true);
    try {
      const result = await browseEffectLibrary({
        ...browseParams(
          filters,
          sectionMeta.show ? excludeIdsRef.current : undefined
        ),
        limit: PAGE_SIZE,
        offset: items.length,
      });
      if (reqId !== requestIdRef.current) return;
      setTotal(result.total);
      setItems((prev) => [...prev, ...result.items]);
    } catch (e) {
      if (reqId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [
    loadingMore,
    initialLoading,
    items.length,
    total,
    filters,
    sectionMeta.show,
  ]);

  const updateFilters = useCallback(
    (patch: Partial<LibraryBrowseFilters>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const visibleCardCount =
    sectionMeta.visibleCount + items.length;
  const catalogTotal = sectionMeta.show
    ? sectionMeta.visibleCount + total
    : total;

  return {
    filters,
    updateFilters,
    items,
    total,
    sections,
    sectionMeta,
    visibleCardCount,
    catalogTotal,
    initialLoading,
    loadingMore,
    error,
    loadMore,
    hasActiveFilters: hasActiveLibraryFilters(filters),
  };
}
