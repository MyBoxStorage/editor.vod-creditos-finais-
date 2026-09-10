import type { EffectLibraryItem, EffectLibraryType } from "./api";

export type LibrarySort =
  | "mostUsed"
  | "recentlyUsed"
  | "recentlyAdded"
  | "alphabetical";

export type LibraryTypeFilter = EffectLibraryType | "all";

export function typeLabel(t: EffectLibraryType): string {
  switch (t) {
    case "video":
      return "Vídeo";
    case "image":
      return "Imagem";
    case "music":
      return "Música";
    case "sfx":
      return "Efeito sonoro";
  }
}

export function formatLibraryDuration(sec: number | null): string {
  if (sec == null || !(sec > 0)) return "—";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function detectTypeFromFileName(fileName: string): EffectLibraryType {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) return "video";
  if (["png", "webp", "jpg", "jpeg", "gif"].includes(ext)) return "image";
  if (["mp3", "m4a", "wav", "ogg", "aac", "flac"].includes(ext)) return "music";
  return "sfx";
}

export function filterLibraryItems(
  items: EffectLibraryItem[],
  opts: {
    search: string;
    typeFilter: LibraryTypeFilter;
    sensationFilters: string[];
    favoritesOnly: boolean;
    includeArchived: boolean;
  }
): EffectLibraryItem[] {
  const q = opts.search.trim().toLowerCase();
  return items.filter((item) => {
    if (!opts.includeArchived && item.status === "archived") return false;
    if (opts.favoritesOnly && !item.isFavorite) return false;
    if (opts.typeFilter !== "all" && item.type !== opts.typeFilter) return false;
    if (opts.sensationFilters.length > 0) {
      const hasAll = opts.sensationFilters.every((tag) =>
        item.sensationTags.includes(tag)
      );
      if (!hasAll) return false;
    }
    if (q) {
      const hay = [
        item.name,
        ...item.tags,
        ...item.sensationTags,
        typeLabel(item.type),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortLibraryItems(
  items: EffectLibraryItem[],
  sort: LibrarySort
): EffectLibraryItem[] {
  const copy = [...items];
  switch (sort) {
    case "mostUsed":
      return copy.sort((a, b) => b.usageCount - a.usageCount);
    case "recentlyUsed":
      return copy.sort((a, b) => {
        const ta = a.lastUsedAt ?? "";
        const tb = b.lastUsedAt ?? "";
        return tb.localeCompare(ta);
      });
    case "recentlyAdded":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "alphabetical":
      return copy.sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
      );
  }
}

export function pinnedItems(items: EffectLibraryItem[]): EffectLibraryItem[] {
  return items.filter((i) => i.isFavorite && i.status === "active");
}

export function topUsedByCategory(
  items: EffectLibraryItem[],
  limit = 20
): { video: EffectLibraryItem[]; audio: EffectLibraryItem[] } {
  const active = items.filter((i) => i.status === "active");
  const video = [...active]
    .filter((i) => i.type === "video")
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);
  const audio = [...active]
    .filter((i) => i.type === "music" || i.type === "sfx")
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);
  return { video, audio };
}

export function gridColumns(width: number, density: "compact" | "wide"): number {
  const minCard = density === "compact" ? 128 : 176;
  return Math.max(1, Math.floor(width / minCard));
}

export const CARD_HEIGHT = 168;
export const CARD_HEIGHT_COMPACT = 108;
