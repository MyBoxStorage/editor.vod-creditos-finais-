"use client";

import { useState } from "react";
import type { EffectLibraryCard, LibraryBrowseSort } from "../../lib/api";
import type { LibraryTypeFilter } from "../../lib/libraryUtils";
import { LibraryCard } from "./LibraryCard";
import { LibraryItemEditor } from "./LibraryItemEditor";
import { SensationTagPicker } from "./SensationTagPicker";
import { VirtualizedGrid } from "./VirtualizedGrid";
import { useLibraryBrowse } from "./useLibraryBrowse";

export type LibraryBrowserMode = "manage" | "pick" | "checkbox";

type Props = {
  density?: "compact" | "wide";
  mode?: LibraryBrowserMode;
  selectedId?: string;
  checkedIds?: Set<string>;
  onSelect?: (item: EffectLibraryCard) => void;
  onToggleCheck?: (item: EffectLibraryCard, checked: boolean) => void;
  onToggleFavorite?: (item: EffectLibraryCard) => void;
  onUpdateItem?: (
    item: EffectLibraryCard,
    patch: { name?: string; sensationTags?: string[]; tags?: string[] }
  ) => void;
  onDeleteItem?: (item: EffectLibraryCard) => void | Promise<void>;
  onArchiveItem?: (item: EffectLibraryCard) => void | Promise<void>;
  onUnarchiveItem?: (item: EffectLibraryCard) => void | Promise<void>;
  onBatchArchive?: (ids: string[]) => void;
  onBatchUnarchive?: (ids: string[]) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchFavorite?: (ids: string[]) => void;
  disabled?: boolean;
  gridHeightClass?: string;
  showSections?: boolean;
  refreshToken?: number;
};

function formatCountLabel(opts: {
  initialLoading: boolean;
  visibleCardCount: number;
  catalogTotal: number;
  gridLoaded: number;
  gridTotal: number;
  sectionVisible: number;
  sectionsShown: boolean;
}): string {
  if (opts.initialLoading && opts.visibleCardCount === 0) {
    return "carregando…";
  }
  if (opts.catalogTotal === 0) {
    return "0 itens";
  }
  if (opts.sectionsShown) {
    if (opts.gridLoaded < opts.gridTotal) {
      return `${opts.visibleCardCount} de ${opts.catalogTotal} itens`;
    }
    return `${opts.catalogTotal} item${opts.catalogTotal !== 1 ? "s" : ""}`;
  }
  if (opts.gridLoaded < opts.gridTotal) {
    return `${opts.gridLoaded} de ${opts.gridTotal} itens`;
  }
  return `${opts.gridTotal} item${opts.gridTotal !== 1 ? "s" : ""}`;
}

export function LibraryBrowser({
  density = "wide",
  mode = "pick",
  selectedId,
  checkedIds,
  onSelect,
  onToggleCheck,
  onToggleFavorite,
  onUpdateItem,
  onDeleteItem,
  onArchiveItem,
  onUnarchiveItem,
  onBatchArchive,
  onBatchUnarchive,
  onBatchDelete,
  onBatchFavorite,
  disabled,
  gridHeightClass = "h-[420px]",
  showSections = true,
  refreshToken = 0,
}: Props) {
  const {
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
    hasActiveFilters,
  } = useLibraryBrowse(refreshToken, showSections);

  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [topOpen, setTopOpen] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<EffectLibraryCard | null>(
    null
  );

  const effectiveChecked =
    mode === "checkbox" ? checkedIds : mode === "manage" ? selection : undefined;

  const cardVariant = density === "compact" ? "compact" : "default";
  const showTopSections = sectionMeta.show && !hasActiveFilters;

  function toggleSensation(tag: string) {
    const next = filters.sensationFilters.includes(tag)
      ? filters.sensationFilters.filter((t) => t !== tag)
      : [...filters.sensationFilters, tag];
    updateFilters({ sensationFilters: next });
  }

  function toggleSelection(id: string, on: boolean) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function renderCard(item: EffectLibraryCard) {
    return (
      <LibraryCard
        key={item.id}
        item={item}
        variant={cardVariant}
        selected={selectedId === item.id}
        checked={effectiveChecked?.has(item.id)}
        selectable={mode !== "manage"}
        showCheckbox={mode === "manage" || mode === "checkbox"}
        showEdit={mode === "manage" && !!onUpdateItem}
        onSelect={onSelect}
        onToggleCheck={(it, c) => {
          if (mode === "checkbox") onToggleCheck?.(it, c);
          else toggleSelection(it.id, c);
        }}
        onToggleFavorite={onToggleFavorite}
        onEdit={setEditingItem}
        disabled={disabled}
      />
    );
  }

  const typeButtons: Array<{ id: LibraryTypeFilter; label: string }> = [
    { id: "all", label: "Todos" },
    { id: "video", label: "Vídeo" },
    { id: "image", label: "Imagem" },
    { id: "music", label: "Música" },
    { id: "sfx", label: "Efeito sonoro" },
  ];

  const countLabel = formatCountLabel({
    initialLoading,
    visibleCardCount,
    catalogTotal,
    gridLoaded: items.length,
    gridTotal: total,
    sectionVisible: sectionMeta.visibleCount,
    sectionsShown: showTopSections,
  });

  const showEmpty =
    !initialLoading && visibleCardCount === 0 && !error;

  return (
    <div className="space-y-3" data-testid="library-browser">
      <div className="space-y-3 rounded border border-zinc-800 bg-zinc-950/40 p-3">
        <input
          type="search"
          value={filters.search}
          onChange={(e) => updateFilters({ search: e.target.value })}
          placeholder="Buscar por nome ou tag…"
          disabled={disabled}
          data-testid="library-search"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        />

        <div className="flex flex-wrap gap-1.5">
          {typeButtons.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              data-testid={`library-type-${t.id}`}
              onClick={() => updateFilters({ typeFilter: t.id })}
              className={`min-h-8 rounded border px-3 py-1.5 text-xs ${
                filters.typeFilter === t.id
                  ? "border-amber-600 bg-amber-950/50 text-amber-100"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            sensação
          </p>
          <SensationTagPicker
            selected={filters.sensationFilters}
            onToggle={toggleSensation}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(e) =>
                updateFilters({ favoritesOnly: e.target.checked })
              }
              disabled={disabled}
            />
            só favoritos
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) =>
                updateFilters({ includeArchived: e.target.checked })
              }
              disabled={disabled}
            />
            incluir arquivados
          </label>
          <label className="flex items-center gap-1.5">
            ordenar
            <select
              value={filters.sort}
              onChange={(e) =>
                updateFilters({ sort: e.target.value as LibraryBrowseSort })
              }
              disabled={disabled}
              className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200"
            >
              <option value="mostUsed">mais usados</option>
              <option value="recentlyUsed">usados recentemente</option>
              <option value="recentlyAdded">adicionados recentemente</option>
              <option value="alphabetical">alfabética</option>
            </select>
          </label>
          <span
            className="text-zinc-300"
            data-testid="library-count"
          >
            {countLabel}
          </span>
        </div>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {showEmpty && (
        <div
          className="rounded border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-10 text-center"
          data-testid="library-empty"
        >
          <p className="text-sm text-zinc-400">Nenhum item encontrado.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Ajuste os filtros ou a busca.
          </p>
        </div>
      )}

      {showTopSections && sections.pinned.length > 0 && (
        <section className="space-y-2" data-testid="library-section-pinned">
          <button
            type="button"
            onClick={() => setPinnedOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-xs font-medium text-amber-200/90"
          >
            <span>{pinnedOpen ? "▼" : "▶"}</span>
            fixados ({sections.pinned.length})
          </button>
          {pinnedOpen && (
            <div
              className={`grid gap-3 ${
                density === "compact"
                  ? "grid-cols-2"
                  : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
              }`}
            >
              {sections.pinned.map((item) => renderCard(item))}
            </div>
          )}
        </section>
      )}

      {showTopSections &&
        (sections.topVideo.length > 0 || sections.topAudio.length > 0) && (
          <section className="space-y-2" data-testid="library-section-top">
            <button
              type="button"
              onClick={() => setTopOpen((v) => !v)}
              className="flex w-full items-center gap-2 text-xs font-medium text-zinc-300"
            >
              <span>{topOpen ? "▼" : "▶"}</span>
              mais usados
            </button>
            {topOpen && (
              <div className="space-y-3">
                {sections.topVideo.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] uppercase text-zinc-500">
                      vídeo
                    </p>
                    <div
                      className={`grid gap-3 ${
                        density === "compact"
                          ? "grid-cols-2"
                          : "grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
                      }`}
                    >
                      {sections.topVideo.map((item) => renderCard(item))}
                    </div>
                  </div>
                )}
                {sections.topAudio.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] uppercase text-zinc-500">
                      sonoro
                    </p>
                    <div
                      className={`grid gap-3 ${
                        density === "compact"
                          ? "grid-cols-2"
                          : "grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
                      }`}
                    >
                      {sections.topAudio.map((item) => renderCard(item))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

      {!showEmpty &&
        (initialLoading && items.length === 0 ? (
          <div
            className={`${gridHeightClass} animate-pulse rounded border border-zinc-800 bg-zinc-900/40`}
            data-testid="library-loading"
          />
        ) : (
          items.length > 0 && (
            <VirtualizedGrid
              itemCount={items.length}
              density={density}
              className={gridHeightClass}
              onReachEnd={loadMore}
              renderItem={(index) => {
                const item = items[index];
                if (!item) return null;
                return renderCard(item);
              }}
            />
          )
        ))}

      {loadingMore && (
        <p className="text-center text-[11px] text-zinc-500">
          Carregando mais…
        </p>
      )}

      {mode === "manage" && selection.size > 0 && (
        <div className="flex flex-wrap gap-2 rounded border border-zinc-700 bg-zinc-900 p-2 text-xs">
          <span className="text-zinc-400">{selection.size} selecionados</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onBatchFavorite?.([...selection]);
              setSelection(new Set());
            }}
            className="rounded border border-zinc-600 px-2 py-0.5 hover:border-amber-500"
          >
            favoritar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onBatchArchive?.([...selection]);
              setSelection(new Set());
            }}
            className="rounded border border-zinc-600 px-2 py-0.5 hover:border-amber-500"
          >
            arquivar
          </button>
          {filters.includeArchived && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onBatchUnarchive?.([...selection]);
                setSelection(new Set());
              }}
              className="rounded border border-zinc-600 px-2 py-0.5 hover:border-lime-500"
            >
              desarquivar
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  `Apagar ${selection.size} item(ns) permanentemente? Esta ação não pode ser desfeita.`
                )
              ) {
                onBatchDelete?.([...selection]);
                setSelection(new Set());
              }
            }}
            className="rounded border border-red-900 px-2 py-0.5 text-red-300 hover:border-red-600"
          >
            apagar
          </button>
        </div>
      )}

      {editingItem && onUpdateItem && (
        <LibraryItemEditor
          item={editingItem}
          open={!!editingItem}
          disabled={disabled}
          onClose={() => setEditingItem(null)}
          onSave={onUpdateItem}
          onDelete={onDeleteItem}
          onArchive={onArchiveItem}
          onUnarchive={onUnarchiveItem}
        />
      )}
    </div>
  );
}
