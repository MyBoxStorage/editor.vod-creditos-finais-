import { Router } from "express";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import {
  archiveEffectLibraryItem,
  backfillLibraryPreviews,
  batchEffectLibraryAction,
  browseEffectLibraryCards,
  bulkCreateEffectLibraryItems,
  createEffectLibraryItem,
  deleteEffectLibraryItem,
  getEffectLibraryItemById,
  getLibrarySections,
  listEffectLibraryItems,
  toggleEffectLibraryFavorite,
  unarchiveEffectLibraryItem,
  updateEffectLibraryItem,
  type EffectLibraryType,
  type LibraryBrowseSort,
} from "../services/effectsLibraryService";
import { detectTypeFromExtension } from "../services/libraryPreviewService";

export const effectsLibraryRouter = Router();

const uploadDir = path.join(os.tmpdir(), "clipvod-effects-upload");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
});

function parseTagsField(raw: unknown): string[] | undefined {
  if (raw == null || raw === "") return undefined;
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // comma-separated
    }
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return undefined;
}

function parseOptionalNumber(raw: unknown): number | null | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * POST /effects-library — multipart: type, name, tags?, sensationTags?, file; video chroma optional.
 */
effectsLibraryRouter.post(
  "/effects-library",
  upload.single("file"),
  async (req, res) => {
    try {
      const type = req.body?.type as string | undefined;
      const name = req.body?.name as string | undefined;
      if (type !== "video" && type !== "image" && type !== "music" && type !== "sfx") {
        res.status(400).json({
          error: 'Body must include type: "video" | "image" | "music" | "sfx"',
        });
        return;
      }
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Body must include name: string" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "multipart field 'file' is required" });
        return;
      }

      const tags = parseTagsField(req.body?.tags);
      const sensationTags = parseTagsField(req.body?.sensationTags);
      const item = await createEffectLibraryItem({
        type: type as EffectLibraryType,
        name,
        tags,
        sensationTags,
        tempFilePath: req.file.path,
        originalFileName: req.file.originalname || "upload.bin",
        chromaKeyColor:
          typeof req.body?.chromaKeyColor === "string"
            ? req.body.chromaKeyColor
            : undefined,
        chromaKeySimilarity: parseOptionalNumber(req.body?.chromaKeySimilarity),
        chromaKeyBlend: parseOptionalNumber(req.body?.chromaKeyBlend),
        backgroundRemovalMode:
          typeof req.body?.backgroundRemovalMode === "string"
            ? req.body.backgroundRemovalMode
            : undefined,
      });

      res.status(201).json({ status: "completed", item });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("must") || message.includes("required")
        ? 400
        : 500;
      res.status(status).json({ error: message });
    }
  }
);

/**
 * POST /effects-library/bulk — multipart files[] + items JSON metadata array.
 */
effectsLibraryRouter.post(
  "/effects-library/bulk",
  upload.array("files", 100),
  async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: "multipart field 'files' is required" });
        return;
      }

      let meta: Array<{
        originalName?: string;
        name?: string;
        type?: EffectLibraryType;
        tags?: string[];
        sensationTags?: string[];
      }> = [];
      if (typeof req.body?.items === "string") {
        meta = JSON.parse(req.body.items) as typeof meta;
      } else if (Array.isArray(req.body?.items)) {
        meta = req.body.items;
      }

      const byName = new Map<string, Express.Multer.File>();
      for (const f of files) {
        byName.set(f.originalname, f);
      }

      const toCreate: Parameters<typeof bulkCreateEffectLibraryItems>[0] = [];
      for (const m of meta.length > 0 ? meta : files.map((f) => ({ originalName: f.originalname }))) {
        const originalName = m.originalName ?? "";
        const file = byName.get(originalName);
        if (!file) continue;
        const baseName = path.basename(
          originalName,
          path.extname(originalName)
        );
        const metaItem = m as {
          type?: EffectLibraryType;
          name?: string;
          tags?: string[];
          sensationTags?: string[];
        };
        const type =
          metaItem.type ?? detectTypeFromExtension(originalName);
        toCreate.push({
          type,
          name: (metaItem.name ?? baseName).trim() || baseName,
          tags: metaItem.tags,
          sensationTags: metaItem.sensationTags,
          tempFilePath: file.path,
          originalFileName: originalName,
        });
      }

      if (toCreate.length === 0) {
        res.status(400).json({ error: "Nenhum arquivo correspondeu aos metadados." });
        return;
      }

      const items = await bulkCreateEffectLibraryItems(toCreate);
      res.status(201).json({ status: "completed", items });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /effects-library/batch — bulk archive, favorite, tags, delete.
 */
effectsLibraryRouter.post("/effects-library/batch", async (req, res) => {
  try {
    const body = req.body ?? {};
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) {
      res.status(400).json({ error: "ids array is required" });
      return;
    }
    const action = body.action as string;
    if (
      action !== "archive" &&
      action !== "unarchive" &&
      action !== "favorite" &&
      action !== "unfavorite" &&
      action !== "delete" &&
      action !== "setTags"
    ) {
      res.status(400).json({ error: "action inválida" });
      return;
    }

    const result = await batchEffectLibraryAction({
      action,
      ids,
      sensationTags: parseTagsField(body.sensationTags),
      tags: parseTagsField(body.tags),
    } as Parameters<typeof batchEffectLibraryAction>[0]);

    res.status(200).json({ status: "completed", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /effects-library/backfill-previews — generate missing thumbnails/waveforms.
 */
effectsLibraryRouter.post(
  "/effects-library/backfill-previews",
  async (_req, res) => {
    try {
      const result = await backfillLibraryPreviews();
      res.status(200).json({ status: "completed", ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /effects-library?type=&tag=&favorite=&includeArchived=
 */
effectsLibraryRouter.get("/effects-library", (req, res) => {
  try {
    const typeRaw = req.query.type;
    const tagRaw = req.query.tag;
    const favRaw = req.query.favorite;
    const archivedRaw = req.query.includeArchived;

    let type: EffectLibraryType | undefined;
    if (typeof typeRaw === "string" && typeRaw) {
      if (
        typeRaw !== "video" &&
        typeRaw !== "image" &&
        typeRaw !== "music" &&
        typeRaw !== "sfx"
      ) {
        res.status(400).json({
          error: 'type must be "video" | "image" | "music" | "sfx"',
        });
        return;
      }
      type = typeRaw;
    }

    let favorite: boolean | undefined;
    if (favRaw === "true" || favRaw === "1") favorite = true;
    else if (favRaw === "false" || favRaw === "0") favorite = false;

    const includeArchived =
      archivedRaw === "true" || archivedRaw === "1";

    const items = listEffectLibraryItems({
      type,
      tag: typeof tagRaw === "string" ? tagRaw : undefined,
      favorite,
      includeArchived,
    });
    res.status(200).json({ status: "ok", items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /effects-library/browse — paginated card summaries; filter/sort in SQL.
 */
effectsLibraryRouter.get("/effects-library/browse", (req, res) => {
  try {
    const typeRaw = req.query.type;
    let type: EffectLibraryType | undefined;
    if (typeof typeRaw === "string" && typeRaw) {
      if (
        typeRaw !== "video" &&
        typeRaw !== "image" &&
        typeRaw !== "music" &&
        typeRaw !== "sfx"
      ) {
        res.status(400).json({
          error: 'type must be "video" | "image" | "music" | "sfx"',
        });
        return;
      }
      type = typeRaw;
    }

    const sortRaw = req.query.sort;
    const validSorts = new Set([
      "mostUsed",
      "recentlyUsed",
      "recentlyAdded",
      "alphabetical",
    ]);
    let sort: LibraryBrowseSort | undefined;
    if (typeof sortRaw === "string" && validSorts.has(sortRaw)) {
      sort = sortRaw as LibraryBrowseSort;
    }

    const sensationRaw = req.query.sensationTags;
    let sensationTags: string[] | undefined;
    if (typeof sensationRaw === "string" && sensationRaw) {
      sensationTags = sensationRaw.split(",").map((t) => t.trim()).filter(Boolean);
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const excludeRaw = req.query.excludeIds;
    let excludeIds: string[] | undefined;
    if (typeof excludeRaw === "string" && excludeRaw.trim()) {
      excludeIds = excludeRaw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    }

    const result = browseEffectLibraryCards({
      type,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      sensationTags,
      favorite: req.query.favorite === "true" || req.query.favorite === "1",
      includeArchived:
        req.query.includeArchived === "true" ||
        req.query.includeArchived === "1",
      sort,
      limit,
      offset,
      excludeIds,
    });

    res.status(200).json({ status: "ok", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /effects-library/sections — fixados + mais usados (top 20 each category).
 */
effectsLibraryRouter.get("/effects-library/sections", (_req, res) => {
  try {
    const sections = getLibrarySections();
    res.status(200).json({ status: "ok", ...sections });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /effects-library/:id — full item (chroma, paths) on demand.
 */
effectsLibraryRouter.get("/effects-library/:id", (req, res) => {
  const { id } = req.params;
  if (
    id === "browse" ||
    id === "sections" ||
    id === "bulk" ||
    id === "batch" ||
    id === "backfill-previews"
  ) {
    res.status(404).json({ error: "not found" });
    return;
  }
  try {
    const item = getEffectLibraryItemById(id);
    res.status(200).json({ status: "ok", item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * PATCH /effects-library/:id
 */
effectsLibraryRouter.patch("/effects-library/:id", (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  try {
    const item = updateEffectLibraryItem(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      tags: parseTagsField(body.tags),
      sensationTags: parseTagsField(body.sensationTags),
      isFavorite:
        typeof body.isFavorite === "boolean" ? body.isFavorite : undefined,
      status:
        body.status === "archived" || body.status === "active"
          ? body.status
          : undefined,
      chromaKeyColor:
        body.chromaKeyColor === null
          ? null
          : typeof body.chromaKeyColor === "string"
            ? body.chromaKeyColor
            : undefined,
      chromaKeySimilarity:
        body.chromaKeySimilarity === null
          ? null
          : typeof body.chromaKeySimilarity === "number"
            ? body.chromaKeySimilarity
            : undefined,
      chromaKeyBlend:
        body.chromaKeyBlend === null
          ? null
          : typeof body.chromaKeyBlend === "number"
            ? body.chromaKeyBlend
            : undefined,
      backgroundRemovalMode:
        typeof body.backgroundRemovalMode === "string"
          ? body.backgroundRemovalMode
          : undefined,
    });
    res.status(200).json({ status: "completed", item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found")
      ? 404
      : message.includes("required")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * DELETE /effects-library/:id — permanent delete with file removal.
 */
effectsLibraryRouter.delete("/effects-library/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await deleteEffectLibraryItem(id);
    res.status(200).json({ status: "completed", id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found")
      ? 404
      : message.includes("aplicado em") || message.includes("applied")
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /effects-library/:id/toggle-favorite
 */
effectsLibraryRouter.post(
  "/effects-library/:id/toggle-favorite",
  (req, res) => {
    const { id } = req.params;
    try {
      const item = toggleEffectLibraryFavorite(id);
      res.status(200).json({ status: "completed", item });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: message });
    }
  }
);

/**
 * POST /effects-library/:id/archive
 */
effectsLibraryRouter.post("/effects-library/:id/archive", (req, res) => {
  const { id } = req.params;
  try {
    const item = archiveEffectLibraryItem(id);
    res.status(200).json({ status: "completed", item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /effects-library/:id/unarchive
 */
effectsLibraryRouter.post("/effects-library/:id/unarchive", (req, res) => {
  const { id } = req.params;
  try {
    const item = unarchiveEffectLibraryItem(id);
    res.status(200).json({ status: "completed", item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});
