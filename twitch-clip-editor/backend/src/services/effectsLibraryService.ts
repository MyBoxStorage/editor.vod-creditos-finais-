import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getDb } from "../db";
import { findClipEditableById } from "./clipEditable";
import { getDataDir } from "./vodIngest";
import {
  generateLibraryPreviews,
} from "./libraryPreviewService";
import { probeImageDimensions } from "./mediaProbe.js";
import { normalizeSensationTags } from "../lib/sensationTags";

function probeDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

/**
 * Effects library (table name: audio_library — legacy).
 * Covers type = "video" | "image" | "music" | "sfx".
 */

export type EffectLibraryType = "video" | "image" | "music" | "sfx";

export type EffectLibraryStatus = "active" | "archived";

export type EffectLibraryItem = {
  id: string;
  type: EffectLibraryType;
  name: string;
  filePath: string;
  durationSeconds: number | null;
  /** Free-form tags (text). */
  tags: string[];
  /** Fixed sensation tags from SENSATION_TAGS list. */
  sensationTags: string[];
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  status: EffectLibraryStatus;
  thumbnailPath: string | null;
  waveformPath: string | null;
  sourceType: string;
  sourceItemId: string | null;
  createdAt: string;
  chromaKeyColor: string | null;
  chromaKeySimilarity: number | null;
  chromaKeyBlend: number | null;
  backgroundRemovalMode: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
};

export type ClipEffectInstance = {
  id: string;
  /** Candidate id OR clip_segment id (universal lookup). */
  clipSegmentId: string;
  effectLibraryItemId: string;
  type: EffectLibraryType;
  sourceTrimStart: number | null;
  sourceTrimEnd: number | null;
  volume: number | null;
  fadeInSeconds: number | null;
  fadeOutSeconds: number | null;
  duckingEnabled: boolean;
  clipTimestamp: number | null;
  positionX: number | null;
  positionY: number | null;
  positionWidth: number | null;
  positionHeight: number | null;
  videoLoopEnabled: boolean;
  /** Joined library metadata when listing applied effects. */
  libraryItem?: EffectLibraryItem;
};

type LibraryRow = {
  id: string;
  type: string;
  name: string;
  file_path: string;
  duration_seconds: number | null;
  tags: string | null;
  sensation_tags: string | null;
  is_favorite: number;
  usage_count: number;
  last_used_at: string | null;
  status: string;
  thumbnail_path: string | null;
  waveform_path: string | null;
  source_type: string;
  source_item_id: string | null;
  created_at: string;
  chroma_key_color: string | null;
  chroma_key_similarity: number | null;
  chroma_key_blend: number | null;
  background_removal_mode: string | null;
  image_width: number | null;
  image_height: number | null;
};

type InstanceRow = {
  id: string;
  clip_segment_id: string;
  audio_library_item_id: string;
  type: string;
  source_trim_start: number | null;
  source_trim_end: number | null;
  volume: number | null;
  fade_in_seconds: number | null;
  fade_out_seconds: number | null;
  ducking_enabled: number;
  clip_timestamp: number | null;
  position_x: number | null;
  position_y: number | null;
  position_width: number | null;
  position_height: number | null;
  video_loop_enabled?: number | null;
};

const VALID_TYPES = new Set<EffectLibraryType>([
  "video",
  "image",
  "music",
  "sfx",
]);

function parseTags(raw: string | null): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string");
    }
  } catch {
    // fall through — comma-separated legacy
  }
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function serializeTags(tags: string[]): string {
  return JSON.stringify(tags);
}

function rowToItem(row: LibraryRow): EffectLibraryItem {
  return {
    id: row.id,
    type: row.type as EffectLibraryType,
    name: row.name,
    filePath: row.file_path,
    durationSeconds: row.duration_seconds,
    tags: parseTags(row.tags),
    sensationTags: parseTags(row.sensation_tags),
    isFavorite: row.is_favorite === 1,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    status: row.status === "archived" ? "archived" : "active",
    thumbnailPath: row.thumbnail_path,
    waveformPath: row.waveform_path,
    sourceType: row.source_type,
    sourceItemId: row.source_item_id,
    createdAt: row.created_at,
    chromaKeyColor: row.chroma_key_color,
    chromaKeySimilarity: row.chroma_key_similarity,
    chromaKeyBlend: row.chroma_key_blend,
    backgroundRemovalMode: row.background_removal_mode,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
  };
}

function rowToInstance(row: InstanceRow): ClipEffectInstance {
  return {
    id: row.id,
    clipSegmentId: row.clip_segment_id,
    effectLibraryItemId: row.audio_library_item_id,
    type: row.type as EffectLibraryType,
    sourceTrimStart: row.source_trim_start,
    sourceTrimEnd: row.source_trim_end,
    volume: row.volume,
    fadeInSeconds: row.fade_in_seconds,
    fadeOutSeconds: row.fade_out_seconds,
    duckingEnabled: row.ducking_enabled === 1,
    clipTimestamp: row.clip_timestamp,
    positionX: row.position_x,
    positionY: row.position_y,
    positionWidth: row.position_width,
    positionHeight: row.position_height,
    videoLoopEnabled: (row.video_loop_enabled ?? 0) === 1,
  };
}

export function getLibraryDir(): string {
  return path.join(getDataDir(), "_library");
}

function absoluteLibraryFilePath(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  return path.join(getDataDir(), relativeOrAbsolute);
}

export function resolveEffectFilePath(item: EffectLibraryItem): string {
  return absoluteLibraryFilePath(item.filePath);
}

function extFromOriginalName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  return "";
}

export type CreateEffectLibraryItemInput = {
  type: EffectLibraryType;
  name: string;
  tags?: string[];
  sensationTags?: string[];
  /** Absolute path to uploaded temp file (moved into library). */
  tempFilePath: string;
  originalFileName: string;
  chromaKeyColor?: string | null;
  chromaKeySimilarity?: number | null;
  chromaKeyBlend?: number | null;
  backgroundRemovalMode?: string | null;
  /** Skip preview generation (bulk backfill later). */
  skipPreviews?: boolean;
};

export async function createEffectLibraryItem(
  input: CreateEffectLibraryItemInput
): Promise<EffectLibraryItem> {
  if (!VALID_TYPES.has(input.type)) {
    throw new Error(`type must be "video" | "image" | "music" | "sfx"`);
  }
  if (!input.name.trim()) {
    throw new Error("name is required");
  }

  const id = randomUUID();
  const ext = extFromOriginalName(input.originalFileName) || ".bin";
  const relDir = path.join("_library", input.type);
  const absDir = path.join(getDataDir(), relDir);
  await fs.mkdir(absDir, { recursive: true });
  const fileName = `${id}${ext}`;
  const absPath = path.join(absDir, fileName);
  const relPath = path.join(relDir, fileName).replace(/\\/g, "/");

  await fs.rename(input.tempFilePath, absPath).catch(async () => {
    await fs.copyFile(input.tempFilePath, absPath);
    await fs.unlink(input.tempFilePath).catch(() => undefined);
  });

  const duration =
    input.type === "image" ? null : await probeDurationSeconds(absPath);

  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  if (input.type === "image") {
    const dims = await probeImageDimensions(absPath);
    if (dims) {
      imageWidth = dims.width;
      imageHeight = dims.height;
    }
  }

  let chromaColor: string | null = null;
  let chromaSim: number | null = null;
  let chromaBlend: number | null = null;
  if (input.type === "video") {
    chromaColor = input.chromaKeyColor ?? "#00FF00";
    chromaSim =
      typeof input.chromaKeySimilarity === "number"
        ? input.chromaKeySimilarity
        : 0.2;
    chromaBlend =
      typeof input.chromaKeyBlend === "number" ? input.chromaKeyBlend : 0.1;
  }

  const backgroundRemovalMode =
    input.type === "video"
      ? input.backgroundRemovalMode ?? "chroma"
      : null;

  const createdAt = new Date().toISOString();
  const sensationTags = normalizeSensationTags(input.sensationTags ?? []);
  const freeTags = input.tags ?? [];

  let thumbnailPath: string | null = null;
  let waveformPath: string | null = null;
  if (!input.skipPreviews) {
    try {
      const previews = await generateLibraryPreviews(
        { id, type: input.type },
        absPath
      );
      thumbnailPath = previews.thumbnailPath;
      waveformPath = previews.waveformPath;
    } catch {
      // preview generation is best-effort on upload
    }
  }

  getDb()
    .prepare(
      `INSERT INTO audio_library (
        id, type, name, file_path, duration_seconds, tags, sensation_tags,
        is_favorite, usage_count, last_used_at, status, thumbnail_path, waveform_path,
        source_type, source_item_id, created_at,
        chroma_key_color, chroma_key_similarity, chroma_key_blend,
        background_removal_mode,
        image_width, image_height
      ) VALUES (
        @id, @type, @name, @file_path, @duration_seconds, @tags, @sensation_tags,
        0, 0, NULL, 'active', @thumbnail_path, @waveform_path,
        'upload', NULL, @created_at,
        @chroma_key_color, @chroma_key_similarity, @chroma_key_blend,
        @background_removal_mode,
        @image_width, @image_height
      )`
    )
    .run({
      id,
      type: input.type,
      name: input.name.trim(),
      file_path: relPath,
      duration_seconds: duration,
      tags: serializeTags(freeTags),
      sensation_tags: serializeTags(sensationTags),
      thumbnail_path: thumbnailPath,
      waveform_path: waveformPath,
      created_at: createdAt,
      chroma_key_color: chromaColor,
      chroma_key_similarity: chromaSim,
      chroma_key_blend: chromaBlend,
      background_removal_mode: backgroundRemovalMode,
      image_width: imageWidth,
      image_height: imageHeight,
    });

  return getEffectLibraryItemById(id);
}

export function getEffectLibraryItemById(id: string): EffectLibraryItem {
  const row = getDb()
    .prepare("SELECT * FROM audio_library WHERE id = ?")
    .get(id) as LibraryRow | undefined;
  if (!row) {
    throw new Error(`effects library item not found: ${id}`);
  }
  return rowToItem(row);
}

export type ListEffectLibraryFilter = {
  type?: EffectLibraryType;
  tag?: string;
  sensationTag?: string;
  favorite?: boolean;
  includeArchived?: boolean;
};

export function listEffectLibraryItems(
  filter: ListEffectLibraryFilter = {}
): EffectLibraryItem[] {
  const rows = getDb()
    .prepare("SELECT * FROM audio_library ORDER BY created_at DESC")
    .all() as LibraryRow[];

  let items = rows.map(rowToItem);
  if (!filter.includeArchived) {
    items = items.filter((i) => i.status === "active");
  }
  if (filter.type) {
    items = items.filter((i) => i.type === filter.type);
  }
  if (filter.favorite === true) {
    items = items.filter((i) => i.isFavorite);
  }
  if (filter.tag) {
    const needle = filter.tag.toLowerCase();
    items = items.filter(
      (i) =>
        i.tags.some((t) => t.toLowerCase() === needle) ||
        i.sensationTags.some((t) => t.toLowerCase() === needle)
    );
  }
  if (filter.sensationTag) {
    const needle = filter.sensationTag.toLowerCase();
    items = items.filter((i) =>
      i.sensationTags.some((t) => t.toLowerCase() === needle)
    );
  }
  return items;
}

/** Lean row for card grid — no chroma, source, or timestamps. */
const LIBRARY_CARD_COLUMNS = `
  id, type, name, duration_seconds, tags, sensation_tags,
  is_favorite, usage_count, status, thumbnail_path, waveform_path, file_path
`;

type LibraryCardRow = {
  id: string;
  type: string;
  name: string;
  duration_seconds: number | null;
  tags: string | null;
  sensation_tags: string | null;
  is_favorite: number;
  usage_count: number;
  status: string;
  thumbnail_path: string | null;
  waveform_path: string | null;
  file_path: string;
};

export type EffectLibraryCard = {
  id: string;
  type: EffectLibraryType;
  name: string;
  durationSeconds: number | null;
  tags: string[];
  sensationTags: string[];
  isFavorite: boolean;
  usageCount: number;
  status: EffectLibraryStatus;
  thumbnailPath: string | null;
  waveformPath: string | null;
  mediaPath: string;
};

function rowToCard(row: LibraryCardRow): EffectLibraryCard {
  return {
    id: row.id,
    type: row.type as EffectLibraryType,
    name: row.name,
    durationSeconds: row.duration_seconds,
    tags: parseTags(row.tags),
    sensationTags: parseTags(row.sensation_tags),
    isFavorite: row.is_favorite === 1,
    usageCount: row.usage_count,
    status: row.status === "archived" ? "archived" : "active",
    thumbnailPath: row.thumbnail_path,
    waveformPath: row.waveform_path,
    mediaPath: row.file_path,
  };
}

export type LibraryBrowseSort =
  | "mostUsed"
  | "recentlyUsed"
  | "recentlyAdded"
  | "alphabetical";

export type BrowseEffectLibraryInput = {
  type?: EffectLibraryType;
  search?: string;
  sensationTags?: string[];
  favorite?: boolean;
  includeArchived?: boolean;
  sort?: LibraryBrowseSort;
  limit?: number;
  offset?: number;
  excludeIds?: string[];
};

function buildBrowseWhere(input: BrowseEffectLibraryInput): {
  where: string;
  params: Record<string, string | number>;
} {
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (!input.includeArchived) {
    conditions.push("status = 'active'");
  }
  if (input.type) {
    conditions.push("type = @type");
    params.type = input.type;
  }
  if (input.favorite) {
    conditions.push("is_favorite = 1");
  }
  if (input.search?.trim()) {
    conditions.push(
      "(LOWER(name) LIKE @search OR LOWER(tags) LIKE @search OR LOWER(sensation_tags) LIKE @search)"
    );
    params.search = `%${input.search.trim().toLowerCase()}%`;
  }
  if (input.sensationTags?.length) {
    input.sensationTags.forEach((tag, i) => {
      const key = `st${i}`;
      conditions.push(`LOWER(sensation_tags) LIKE @${key}`);
      params[key] = `%"${tag.toLowerCase()}"%`;
    });
  }
  if (input.excludeIds?.length) {
    const slice = input.excludeIds.slice(0, 200);
    slice.forEach((id, i) => {
      const key = `ex${i}`;
      conditions.push(`id != @${key}`);
      params[key] = id;
    });
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

function browseOrderBy(sort: LibraryBrowseSort | undefined): string {
  switch (sort) {
    case "recentlyUsed":
      return "last_used_at IS NULL, last_used_at DESC";
    case "recentlyAdded":
      return "created_at DESC";
    case "alphabetical":
      return "name COLLATE NOCASE ASC";
    case "mostUsed":
    default:
      return "usage_count DESC, name COLLATE NOCASE ASC";
  }
}

export function browseEffectLibraryCards(
  input: BrowseEffectLibraryInput = {}
): { items: EffectLibraryCard[]; total: number } {
  const { where, params } = buildBrowseWhere(input);
  const orderBy = browseOrderBy(input.sort);
  const limit = Math.min(Math.max(input.limit ?? 48, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  const db = getDb();
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM audio_library ${where}`)
    .get(params) as { c: number };

  const rows = db
    .prepare(
      `SELECT ${LIBRARY_CARD_COLUMNS} FROM audio_library ${where}
       ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as LibraryCardRow[];

  return { items: rows.map(rowToCard), total: totalRow.c };
}

export function getLibrarySections(): {
  pinned: EffectLibraryCard[];
  topVideo: EffectLibraryCard[];
  topAudio: EffectLibraryCard[];
} {
  const db = getDb();
  const pinned = db
    .prepare(
      `SELECT ${LIBRARY_CARD_COLUMNS} FROM audio_library
       WHERE is_favorite = 1 AND status = 'active'
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all() as LibraryCardRow[];
  const topVideo = db
    .prepare(
      `SELECT ${LIBRARY_CARD_COLUMNS} FROM audio_library
       WHERE type = 'video' AND status = 'active'
       ORDER BY usage_count DESC LIMIT 20`
    )
    .all() as LibraryCardRow[];
  const topAudio = db
    .prepare(
      `SELECT ${LIBRARY_CARD_COLUMNS} FROM audio_library
       WHERE type IN ('music', 'sfx') AND status = 'active'
       ORDER BY usage_count DESC LIMIT 20`
    )
    .all() as LibraryCardRow[];

  return {
    pinned: pinned.map(rowToCard),
    topVideo: topVideo.map(rowToCard),
    topAudio: topAudio.map(rowToCard),
  };
}

export async function deleteSeedLibraryItems(): Promise<number> {
  const rows = getDb()
    .prepare("SELECT id FROM audio_library WHERE tags LIKE '%\"seed\"%'")
    .all() as Array<{ id: string }>;
  let deleted = 0;
  for (const row of rows) {
    try {
      await deleteEffectLibraryItem(row.id);
      deleted += 1;
    } catch {
      // skip items in use
    }
  }
  return deleted;
}

export type UpdateEffectLibraryItemInput = {
  name?: string;
  tags?: string[];
  sensationTags?: string[];
  isFavorite?: boolean;
  status?: EffectLibraryStatus;
  chromaKeyColor?: string | null;
  chromaKeySimilarity?: number | null;
  chromaKeyBlend?: number | null;
  backgroundRemovalMode?: string | null;
};

export function updateEffectLibraryItem(
  id: string,
  input: UpdateEffectLibraryItemInput
): EffectLibraryItem {
  const existing = getEffectLibraryItemById(id);
  const name =
    typeof input.name === "string" ? input.name.trim() : existing.name;
  if (!name) throw new Error("name is required");

  const tags = input.tags ?? existing.tags;
  const sensationTags =
    input.sensationTags !== undefined
      ? normalizeSensationTags(input.sensationTags)
      : existing.sensationTags;
  const isFavorite =
    typeof input.isFavorite === "boolean"
      ? input.isFavorite
      : existing.isFavorite;
  const status = input.status ?? existing.status;

  let chromaColor = existing.chromaKeyColor;
  let chromaSim = existing.chromaKeySimilarity;
  let chromaBlend = existing.chromaKeyBlend;
  let bgMode = existing.backgroundRemovalMode;
  if (existing.type === "video") {
    if (input.chromaKeyColor !== undefined) chromaColor = input.chromaKeyColor;
    if (input.chromaKeySimilarity !== undefined)
      chromaSim = input.chromaKeySimilarity;
    if (input.chromaKeyBlend !== undefined) chromaBlend = input.chromaKeyBlend;
    if (input.backgroundRemovalMode !== undefined)
      bgMode = input.backgroundRemovalMode;
  }

  getDb()
    .prepare(
      `UPDATE audio_library SET
        name = @name,
        tags = @tags,
        sensation_tags = @sensation_tags,
        is_favorite = @is_favorite,
        status = @status,
        chroma_key_color = @chroma_key_color,
        chroma_key_similarity = @chroma_key_similarity,
        chroma_key_blend = @chroma_key_blend,
        background_removal_mode = @background_removal_mode
       WHERE id = @id`
    )
    .run({
      id,
      name,
      tags: serializeTags(tags),
      sensation_tags: serializeTags(sensationTags),
      is_favorite: isFavorite ? 1 : 0,
      status,
      chroma_key_color: chromaColor,
      chroma_key_similarity: chromaSim,
      chroma_key_blend: chromaBlend,
      background_removal_mode: bgMode,
    });

  return getEffectLibraryItemById(id);
}

export function toggleEffectLibraryFavorite(id: string): EffectLibraryItem {
  const existing = getEffectLibraryItemById(id);
  return updateEffectLibraryItem(id, { isFavorite: !existing.isFavorite });
}

export function archiveEffectLibraryItem(id: string): EffectLibraryItem {
  return updateEffectLibraryItem(id, { status: "archived" });
}

export function unarchiveEffectLibraryItem(id: string): EffectLibraryItem {
  return updateEffectLibraryItem(id, { status: "active" });
}

export type BatchLibraryAction =
  | { action: "archive"; ids: string[] }
  | { action: "unarchive"; ids: string[] }
  | { action: "favorite"; ids: string[] }
  | { action: "unfavorite"; ids: string[] }
  | { action: "delete"; ids: string[] }
  | {
      action: "setTags";
      ids: string[];
      sensationTags?: string[];
      tags?: string[];
    };

export async function batchEffectLibraryAction(
  input: BatchLibraryAction
): Promise<{ updated: number; deleted: number }> {
  let updated = 0;
  let deleted = 0;
  for (const id of input.ids) {
    try {
      if (input.action === "delete") {
        await deleteEffectLibraryItem(id);
        deleted += 1;
      } else if (input.action === "archive") {
        archiveEffectLibraryItem(id);
        updated += 1;
      } else if (input.action === "unarchive") {
        unarchiveEffectLibraryItem(id);
        updated += 1;
      } else if (input.action === "favorite") {
        updateEffectLibraryItem(id, { isFavorite: true });
        updated += 1;
      } else if (input.action === "unfavorite") {
        updateEffectLibraryItem(id, { isFavorite: false });
        updated += 1;
      } else if (input.action === "setTags") {
        const patch: UpdateEffectLibraryItemInput = {};
        if (input.sensationTags !== undefined) {
          patch.sensationTags = input.sensationTags;
        }
        if (input.tags !== undefined) patch.tags = input.tags;
        updateEffectLibraryItem(id, patch);
        updated += 1;
      }
    } catch {
      // skip items that fail (e.g. delete while in use)
    }
  }
  return { updated, deleted };
}

export async function deleteEffectLibraryItem(id: string): Promise<void> {
  const item = getEffectLibraryItemById(id);
  const inUse = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM clip_audio_instances WHERE audio_library_item_id = ?"
    )
    .get(id) as { c: number };
  if (inUse.c > 0) {
    throw new Error(
      `Não é possível apagar: este item está aplicado em ${inUse.c} clipe(s). Arquive-o para ocultá-lo da navegação.`
    );
  }

  getDb().prepare("DELETE FROM audio_library WHERE id = ?").run(id);
  const abs = resolveEffectFilePath(item);
  await fs.unlink(abs).catch(() => undefined);
  if (item.thumbnailPath) {
    await fs
      .unlink(path.join(getDataDir(), item.thumbnailPath))
      .catch(() => undefined);
  }
  if (item.waveformPath) {
    await fs
      .unlink(path.join(getDataDir(), item.waveformPath))
      .catch(() => undefined);
  }
}

function incrementUsageCount(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE audio_library SET usage_count = usage_count + 1, last_used_at = @now WHERE id = @id"
    )
    .run({ id, now });
}

export async function backfillLibraryPreviews(): Promise<{
  processed: number;
  elapsedMs: number;
}> {
  const start = Date.now();
  const rows = getDb()
    .prepare("SELECT * FROM audio_library")
    .all() as LibraryRow[];
  let processed = 0;
  for (const row of rows) {
    const item = rowToItem(row);
    const needsThumb = item.type === "video" && !item.thumbnailPath;
    const needsWave = item.type !== "video" && !item.waveformPath;
    if (!needsThumb && !needsWave) continue;
    try {
      const abs = resolveEffectFilePath(item);
      const previews = await generateLibraryPreviews(item, abs);
      getDb()
        .prepare(
          `UPDATE audio_library SET thumbnail_path = COALESCE(@thumbnail_path, thumbnail_path),
           waveform_path = COALESCE(@waveform_path, waveform_path) WHERE id = @id`
        )
        .run({
          id: item.id,
          thumbnail_path: previews.thumbnailPath,
          waveform_path: previews.waveformPath,
        });
      processed += 1;
    } catch {
      // skip broken files
    }
  }
  return { processed, elapsedMs: Date.now() - start };
}

export type BulkCreateItemInput = {
  type: EffectLibraryType;
  name: string;
  tags?: string[];
  sensationTags?: string[];
  tempFilePath: string;
  originalFileName: string;
  skipPreviews?: boolean;
};

export async function bulkCreateEffectLibraryItems(
  items: BulkCreateItemInput[]
): Promise<EffectLibraryItem[]> {
  const out: EffectLibraryItem[] = [];
  for (const item of items) {
    out.push(await createEffectLibraryItem(item));
  }
  return out;
}

export type ApplyEffectInput = {
  effectLibraryItemId: string;
  sourceTrimStart?: number | null;
  sourceTrimEnd?: number | null;
  clipTimestamp?: number | null;
  /** Video */
  positionX?: number | null;
  positionY?: number | null;
  positionWidth?: number | null;
  positionHeight?: number | null;
  /** Music / sfx */
  volume?: number | null;
  fadeInSeconds?: number | null;
  fadeOutSeconds?: number | null;
  duckingEnabled?: boolean;
  videoLoopEnabled?: boolean;
};

export async function applyEffectToClip(
  editableId: string,
  input: ApplyEffectInput
): Promise<ClipEffectInstance> {
  await findClipEditableById(editableId);
  const libraryItem = getEffectLibraryItemById(input.effectLibraryItemId);

  const instanceId = randomUUID();
  const type = libraryItem.type;

  let positionX: number | null = null;
  let positionY: number | null = null;
  let positionWidth: number | null = null;
  let positionHeight: number | null = null;
  let volume: number | null = null;
  let fadeIn: number | null = null;
  let fadeOut: number | null = null;
  let ducking = 0;

  if (type === "video" || type === "image") {
    positionX =
      typeof input.positionX === "number" ? input.positionX : 0;
    positionY =
      typeof input.positionY === "number" ? input.positionY : 0;
    positionWidth =
      typeof input.positionWidth === "number" ? input.positionWidth : 100;
    positionHeight =
      typeof input.positionHeight === "number" ? input.positionHeight : 100;
    fadeIn =
      typeof input.fadeInSeconds === "number" ? input.fadeInSeconds : 0;
    fadeOut =
      typeof input.fadeOutSeconds === "number" ? input.fadeOutSeconds : 0;
  } else {
    volume = typeof input.volume === "number" ? input.volume : 1;
    if (type === "music") {
      fadeIn =
        typeof input.fadeInSeconds === "number" ? input.fadeInSeconds : 0;
      fadeOut =
        typeof input.fadeOutSeconds === "number" ? input.fadeOutSeconds : 0;
      ducking = input.duckingEnabled ? 1 : 0;
    }
  }

  const clipTimestamp =
    typeof input.clipTimestamp === "number" ? input.clipTimestamp : 0;
  const videoLoop =
    type === "video" && input.videoLoopEnabled === true ? 1 : 0;

  getDb()
    .prepare(
      `INSERT INTO clip_audio_instances (
        id, clip_segment_id, audio_library_item_id, type,
        source_trim_start, source_trim_end, volume,
        fade_in_seconds, fade_out_seconds, ducking_enabled, clip_timestamp,
        position_x, position_y, position_width, position_height,
        video_loop_enabled
      ) VALUES (
        @id, @clip_segment_id, @audio_library_item_id, @type,
        @source_trim_start, @source_trim_end, @volume,
        @fade_in_seconds, @fade_out_seconds, @ducking_enabled, @clip_timestamp,
        @position_x, @position_y, @position_width, @position_height,
        @video_loop_enabled
      )`
    )
    .run({
      id: instanceId,
      clip_segment_id: editableId,
      audio_library_item_id: libraryItem.id,
      type,
      source_trim_start:
        typeof input.sourceTrimStart === "number"
          ? input.sourceTrimStart
          : null,
      source_trim_end:
        typeof input.sourceTrimEnd === "number" ? input.sourceTrimEnd : null,
      volume,
      fade_in_seconds: fadeIn,
      fade_out_seconds: fadeOut,
      ducking_enabled: ducking,
      clip_timestamp: clipTimestamp,
      position_x: positionX,
      position_y: positionY,
      position_width: positionWidth,
      position_height: positionHeight,
      video_loop_enabled: videoLoop,
    });

  incrementUsageCount(libraryItem.id);

  const instance = getEffectInstanceById(instanceId);
  instance.libraryItem = libraryItem;
  return instance;
}

export function getEffectInstanceById(id: string): ClipEffectInstance {
  const row = getDb()
    .prepare("SELECT * FROM clip_audio_instances WHERE id = ?")
    .get(id) as InstanceRow | undefined;
  if (!row) {
    throw new Error(`effect instance not found: ${id}`);
  }
  return rowToInstance(row);
}

export async function listEffectsForClip(
  editableId: string
): Promise<ClipEffectInstance[]> {
  await findClipEditableById(editableId);

  const loadRows = (id: string) =>
    getDb()
      .prepare(
        "SELECT * FROM clip_audio_instances WHERE clip_segment_id = ? ORDER BY clip_timestamp ASC, id ASC"
      )
      .all(id) as InstanceRow[];

  let rows = loadRows(editableId);
  if (rows.length === 0) {
    const parent = getDb()
      .prepare("SELECT candidate_id FROM clip_segments WHERE id = ?")
      .get(editableId) as { candidate_id: string | null } | undefined;
    if (parent?.candidate_id) {
      rows = loadRows(parent.candidate_id);
    }
  }

  return rows.map((row) => {
    const instance = rowToInstance(row);
    try {
      instance.libraryItem = getEffectLibraryItemById(
        instance.effectLibraryItemId
      );
    } catch {
      // library row missing — still return instance
    }
    return instance;
  });
}

export async function removeEffectFromClip(
  editableId: string,
  instanceId: string
): Promise<void> {
  await findClipEditableById(editableId);
  const row = getDb()
    .prepare(
      "SELECT * FROM clip_audio_instances WHERE id = ? AND clip_segment_id = ?"
    )
    .get(instanceId, editableId) as InstanceRow | undefined;
  if (!row) {
    throw new Error(
      `effect instance not found: ${instanceId} on clip ${editableId}`
    );
  }
  getDb().prepare("DELETE FROM clip_audio_instances WHERE id = ?").run(instanceId);
}

export type UpdateEffectInput = {
  sourceTrimStart?: number | null;
  sourceTrimEnd?: number | null;
  clipTimestamp?: number | null;
  positionX?: number | null;
  positionY?: number | null;
  positionWidth?: number | null;
  positionHeight?: number | null;
  volume?: number | null;
  fadeInSeconds?: number | null;
  fadeOutSeconds?: number | null;
  duckingEnabled?: boolean;
  videoLoopEnabled?: boolean;
};

export async function updateEffectOnClip(
  editableId: string,
  instanceId: string,
  input: UpdateEffectInput
): Promise<ClipEffectInstance> {
  await findClipEditableById(editableId);
  const existing = getDb()
    .prepare(
      "SELECT * FROM clip_audio_instances WHERE id = ? AND clip_segment_id = ?"
    )
    .get(instanceId, editableId) as InstanceRow | undefined;
  if (!existing) {
    throw new Error(
      `effect instance not found: ${instanceId} on clip ${editableId}`
    );
  }

  const sourceTrimStart =
    input.sourceTrimStart !== undefined
      ? input.sourceTrimStart
      : existing.source_trim_start;
  const sourceTrimEnd =
    input.sourceTrimEnd !== undefined
      ? input.sourceTrimEnd
      : existing.source_trim_end;
  const clipTimestamp =
    input.clipTimestamp !== undefined
      ? input.clipTimestamp
      : existing.clip_timestamp;

  getDb()
    .prepare(
      `UPDATE clip_audio_instances SET
        source_trim_start = @source_trim_start,
        source_trim_end = @source_trim_end,
        clip_timestamp = @clip_timestamp,
        position_x = COALESCE(@position_x, position_x),
        position_y = COALESCE(@position_y, position_y),
        position_width = COALESCE(@position_width, position_width),
        position_height = COALESCE(@position_height, position_height),
        volume = COALESCE(@volume, volume),
        fade_in_seconds = COALESCE(@fade_in_seconds, fade_in_seconds),
        fade_out_seconds = COALESCE(@fade_out_seconds, fade_out_seconds),
        ducking_enabled = COALESCE(@ducking_enabled, ducking_enabled),
        video_loop_enabled = COALESCE(@video_loop_enabled, video_loop_enabled)
      WHERE id = @id`
    )
    .run({
      id: instanceId,
      source_trim_start: sourceTrimStart,
      source_trim_end: sourceTrimEnd,
      clip_timestamp: clipTimestamp,
      position_x: input.positionX ?? null,
      position_y: input.positionY ?? null,
      position_width: input.positionWidth ?? null,
      position_height: input.positionHeight ?? null,
      volume: input.volume ?? null,
      fade_in_seconds: input.fadeInSeconds ?? null,
      fade_out_seconds: input.fadeOutSeconds ?? null,
      ducking_enabled:
        input.duckingEnabled !== undefined
          ? input.duckingEnabled
            ? 1
            : 0
          : null,
      video_loop_enabled:
        input.videoLoopEnabled !== undefined
          ? input.videoLoopEnabled
            ? 1
            : 0
          : null,
    });

  const instance = getEffectInstanceById(instanceId);
  try {
    instance.libraryItem = getEffectLibraryItemById(
      instance.effectLibraryItemId
    );
  } catch {
    // library row missing
  }
  return instance;
}

/** Load applied effects with resolved absolute file paths for ffmpeg export. */
export function loadEffectsForExport(editableId: string): Array<{
  instance: ClipEffectInstance;
  libraryItem: EffectLibraryItem;
  absoluteFilePath: string;
}> {
  const loadFor = (id: string) => {
    const rows = getDb()
      .prepare(
        "SELECT * FROM clip_audio_instances WHERE clip_segment_id = ? ORDER BY clip_timestamp ASC, id ASC"
      )
      .all(id) as InstanceRow[];

    const out: Array<{
      instance: ClipEffectInstance;
      libraryItem: EffectLibraryItem;
      absoluteFilePath: string;
    }> = [];

    for (const row of rows) {
      const instance = rowToInstance(row);
      let libraryItem: EffectLibraryItem;
      try {
        libraryItem = getEffectLibraryItemById(instance.effectLibraryItemId);
      } catch {
        continue;
      }
      out.push({
        instance,
        libraryItem,
        absoluteFilePath: resolveEffectFilePath(libraryItem),
      });
    }
    return out;
  };

  const own = loadFor(editableId);
  if (own.length > 0) return own;

  // clip_segment without its own rows: fall back to parent candidate effects
  // (common after "Enviar para edição" before this sprint copied instances).
  const parent = getDb()
    .prepare("SELECT candidate_id FROM clip_segments WHERE id = ?")
    .get(editableId) as { candidate_id: string | null } | undefined;
  if (parent?.candidate_id) {
    return loadFor(parent.candidate_id);
  }
  return [];
}

/** Duplicate all effect instances from one clip id onto another (new row ids). */
export function copyEffectInstancesToClip(
  fromEditableId: string,
  toEditableId: string
): number {
  const rows = getDb()
    .prepare("SELECT * FROM clip_audio_instances WHERE clip_segment_id = ?")
    .all(fromEditableId) as InstanceRow[];
  if (rows.length === 0) return 0;

  const insert = getDb().prepare(
    `INSERT INTO clip_audio_instances (
      id, clip_segment_id, audio_library_item_id, type,
      source_trim_start, source_trim_end, volume,
      fade_in_seconds, fade_out_seconds, ducking_enabled, clip_timestamp,
      position_x, position_y, position_width, position_height
    ) VALUES (
      @id, @clip_segment_id, @audio_library_item_id, @type,
      @source_trim_start, @source_trim_end, @volume,
      @fade_in_seconds, @fade_out_seconds, @ducking_enabled, @clip_timestamp,
      @position_x, @position_y, @position_width, @position_height
    )`
  );

  let n = 0;
  for (const row of rows) {
    insert.run({
      id: randomUUID(),
      clip_segment_id: toEditableId,
      audio_library_item_id: row.audio_library_item_id,
      type: row.type,
      source_trim_start: row.source_trim_start,
      source_trim_end: row.source_trim_end,
      volume: row.volume,
      fade_in_seconds: row.fade_in_seconds,
      fade_out_seconds: row.fade_out_seconds,
      ducking_enabled: row.ducking_enabled,
      clip_timestamp: row.clip_timestamp,
      position_x: row.position_x,
      position_y: row.position_y,
      position_width: row.position_width,
      position_height: row.position_height,
    });
    n += 1;
  }
  return n;
}
