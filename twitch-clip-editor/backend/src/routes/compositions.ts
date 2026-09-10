import { Router } from "express";
import {
  addSegmentToComposition,
  createComposition,
  exportComposition,
  getCompositionWithSegments,
  listCompositionsForVod,
  removeSegmentFromComposition,
  reorderCompositionSegments,
  updateCompositionSubtitleSettings,
  updateCompositionJoinSettings,
  updateCompositionColorSettings,
  updateCompositionOpeningSettings,
  updateCompositionClosingSettings,
} from "../services/compositionsService";
import {
  cloneClipSegmentForReuse,
  countCompositionsUsingSegment,
  getClipSegmentById,
  saveClipSegmentPresetApplications,
  trimClipSegmentInterval,
} from "../services/clipSegmentsService";
import type { QualityId } from "../services/qualityPresets";
import {
  exportUnifiedComposition,
  type UnifiedSegmentExportInput,
} from "../services/unifiedCompositionExportService";
import {
  compositionPreviewRenderWindow,
  type CompositionPreviewSegmentInput,
} from "../services/compositionPreviewRenderService";
import type { PresetApplicationPayload } from "../services/candidateExportService";

export const compositionsRouter = Router();

function normalizeSegmentExportBody(
  raw: unknown
): UnifiedSegmentExportInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: UnifiedSegmentExportInput[] = [];
  for (const item of raw) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { clipSegmentId?: unknown }).clipSegmentId !== "string"
    ) {
      return null;
    }
    const row = item as {
      clipSegmentId: string;
      finalStart?: number;
      finalEnd?: number;
      presetApplications?: PresetApplicationPayload[];
    };
    out.push({
      clipSegmentId: row.clipSegmentId,
      ...(typeof row.finalStart === "number" ? { finalStart: row.finalStart } : {}),
      ...(typeof row.finalEnd === "number" ? { finalEnd: row.finalEnd } : {}),
      ...(Array.isArray(row.presetApplications)
        ? { presetApplications: row.presetApplications }
        : {}),
    });
  }
  return out;
}

function normalizePreviewSegmentsBody(
  raw: unknown
): CompositionPreviewSegmentInput[] | null {
  return normalizeSegmentExportBody(raw);
}

/**
 * Body: { vodId?, name?, clipSegmentIds: string[] } — at least one id required.
 * Hooks are forced to order_index 0 automatically.
 */
compositionsRouter.get("/vod/:vodId/compositions", async (req, res) => {
  const { vodId } = req.params;
  try {
    const compositions = listCompositionsForVod(vodId);
    res.status(200).json({ vodId, compositions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

compositionsRouter.post("/compositions", async (req, res) => {
  const body = req.body ?? {};
  const { vodId, name, clipSegmentIds } = body;

  if (!Array.isArray(clipSegmentIds) || clipSegmentIds.length === 0) {
    res.status(400).json({
      error: "Body must include clipSegmentIds: non-empty string[]",
    });
    return;
  }

  try {
    const composition = createComposition({
      vodId: typeof vodId === "string" ? vodId : undefined,
      name: typeof name === "string" ? name : undefined,
      clipSegmentIds,
    });
    res.status(200).json({
      status: "completed",
      composition,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("must") ||
      message.includes("not found") ||
      message.includes("duplicate") ||
      message.includes("same VOD")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

compositionsRouter.get("/compositions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const composition = getCompositionWithSegments(id);
    res.status(200).json({ composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Body: { clipSegmentId: string }
 */
compositionsRouter.post("/compositions/:id/segments", async (req, res) => {
  const { id } = req.params;
  const { clipSegmentId } = req.body ?? {};
  if (typeof clipSegmentId !== "string" || !clipSegmentId) {
    res.status(400).json({ error: "Body must include clipSegmentId: string" });
    return;
  }
  try {
    const composition = addSegmentToComposition(id, clipSegmentId);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found")
        ? 404
        : message.includes("already") ||
            message.includes("does not match") ||
            message.includes("must")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

compositionsRouter.delete(
  "/compositions/:id/segments/:clipSegmentId",
  async (req, res) => {
    const { id, clipSegmentId } = req.params;
    try {
      const composition = removeSegmentFromComposition(id, clipSegmentId);
      res.status(200).json({ status: "completed", composition });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("not found") || message.includes("is not in")
          ? 404
          : message.includes("Cannot remove")
            ? 400
            : 500;
      res.status(status).json({ error: message });
    }
  }
);

/**
 * Body: { clipSegmentIds: string[] } — full permutation of current members.
 * Hooks are forced to the front if the client tries to move them.
 */
compositionsRouter.post("/compositions/:id/reorder", async (req, res) => {
  const { id } = req.params;
  const { clipSegmentIds } = req.body ?? {};
  if (!Array.isArray(clipSegmentIds) || clipSegmentIds.length === 0) {
    res.status(400).json({
      error: "Body must include clipSegmentIds: non-empty string[]",
    });
    return;
  }
  try {
    const composition = reorderCompositionSegments(id, clipSegmentIds);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found")
        ? 404
        : message.includes("must include")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Body: { quality: "draft"|"hd"|"max" }
 * Requires each clip_segment already individually exported.
 */
compositionsRouter.post("/compositions/:id/export", async (req, res) => {
  const { id } = req.params;
  const { quality } = req.body ?? {};
  if (quality !== "draft" && quality !== "hd" && quality !== "max") {
    res.status(400).json({
      error: 'Body must include quality: "draft" | "hd" | "max"',
    });
    return;
  }
  try {
    const result = await exportComposition(id, quality as QualityId);
    res.status(200).json({
      status: "completed",
      compositionId: id,
      compositionStatus: result.composition.status,
      quality,
      runId: result.runId,
      prontosPath: result.prontosPath,
      prontosRelativePath: result.prontosRelativePath,
      targetResolution: result.targetResolution,
      normalized: result.normalized,
      elapsedMs: result.elapsedMs,
      composition: result.composition,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found")
        ? 404
        : message.includes("must be exported") ||
            message.includes("Invalid quality") ||
            message.includes("missing") ||
            message.includes("no segments")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Single-pass render from source.mp4 (camada 3 — contract §20.2).
 * Body: { vodId, quality, preset, speed?, outputName?, segments: [{ clipSegmentId, finalStart?, finalEnd?, presetApplications? }] }
 */
compositionsRouter.post("/compositions/unified-export", async (req, res) => {
  const body = req.body ?? {};
  const { vodId, quality, preset, speed, outputName } = body;
  const segments = normalizeSegmentExportBody(body.segments);

  if (typeof vodId !== "string" || !vodId) {
    res.status(400).json({ error: "Body must include vodId: string" });
    return;
  }
  if (quality !== "draft" && quality !== "hd" && quality !== "max") {
    res.status(400).json({
      error: 'Body must include quality: "draft" | "hd" | "max"',
    });
    return;
  }
  if (typeof preset !== "string" || !preset) {
    res.status(400).json({ error: "Body must include preset: string" });
    return;
  }
  if (!segments) {
    res.status(400).json({
      error:
        "Body must include segments: non-empty array of { clipSegmentId, ... }",
    });
    return;
  }

  try {
    const result = await exportUnifiedComposition({
      vodId,
      quality: quality as QualityId,
      preset,
      segments,
      ...(typeof speed === "number" ? { speed } : {}),
      ...(typeof outputName === "string" ? { outputName } : {}),
      ...(body.joinSettings ? { joinSettings: body.joinSettings } : {}),
      ...(body.colorSettings ? { colorSettings: body.colorSettings } : {}),
      ...(body.openingSettings ? { openingSettings: body.openingSettings } : {}),
      ...(body.closingSettings ? { closingSettings: body.closingSettings } : {}),
      ...(body.subtitleSettings ? { subtitleSettings: body.subtitleSettings } : {}),
      ...(Array.isArray(body.segmentSubtitleInputs)
        ? { segmentSubtitleInputs: body.segmentSubtitleInputs }
        : {}),
      ...(typeof body.burnSubtitles === "boolean"
        ? { burnSubtitles: body.burnSubtitles }
        : {}),
    });
    res.status(200).json({
      status: "completed",
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

/**
 * Faithful NVENC preview window for composed clip (contract §20.2).
 * Body: { vodId, preset, speed?, windowStart, windowEnd, segments: [...] }
 */
compositionsRouter.post("/compositions/unified-preview", async (req, res) => {
  const body = req.body ?? {};
  const { vodId, preset, speed, windowStart, windowEnd } = body;
  const segments = normalizePreviewSegmentsBody(body.segments);

  if (typeof vodId !== "string" || !vodId) {
    res.status(400).json({ error: "Body must include vodId: string" });
    return;
  }
  if (typeof preset !== "string" || !preset) {
    res.status(400).json({ error: "Body must include preset: string" });
    return;
  }
  if (typeof windowStart !== "number" || typeof windowEnd !== "number") {
    res.status(400).json({
      error: "Body must include windowStart and windowEnd as numbers",
    });
    return;
  }
  if (!segments) {
    res.status(400).json({
      error:
        "Body must include segments: non-empty array of { clipSegmentId, ... }",
    });
    return;
  }

  try {
    const result = await compositionPreviewRenderWindow({
      vodId,
      preset,
      segments,
      windowStart,
      windowEnd,
      ...(typeof speed === "number" ? { speed } : {}),
      ...(body.joinSettings ? { joinSettings: body.joinSettings } : {}),
      ...(body.colorSettings ? { colorSettings: body.colorSettings } : {}),
      ...(body.openingSettings ? { openingSettings: body.openingSettings } : {}),
      ...(body.closingSettings ? { closingSettings: body.closingSettings } : {}),
      ...(body.subtitleSettings ? { subtitleSettings: body.subtitleSettings } : {}),
      ...(Array.isArray(body.segmentSubtitleInputs)
        ? { segmentSubtitleInputs: body.segmentSubtitleInputs }
        : {}),
    });
    res.status(200).json({ status: "completed", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

/**
 * Body: { subtitleSettings: object }
 */
compositionsRouter.patch("/compositions/:id/subtitle-settings", async (req, res) => {
  const { id } = req.params;
  const { subtitleSettings } = req.body ?? {};
  if (!subtitleSettings || typeof subtitleSettings !== "object") {
    res.status(400).json({ error: "Body must include subtitleSettings: object" });
    return;
  }
  try {
    const composition = updateCompositionSubtitleSettings(id, subtitleSettings);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

compositionsRouter.patch("/compositions/:id/join-settings", async (req, res) => {
  const { id } = req.params;
  const { joinSettings } = req.body ?? {};
  if (!joinSettings || typeof joinSettings !== "object") {
    res.status(400).json({ error: "Body must include joinSettings: object" });
    return;
  }
  try {
    const composition = updateCompositionJoinSettings(id, joinSettings);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

compositionsRouter.patch("/compositions/:id/color-settings", async (req, res) => {
  const { id } = req.params;
  const { colorSettings } = req.body ?? {};
  if (!colorSettings || typeof colorSettings !== "object") {
    res.status(400).json({ error: "Body must include colorSettings: object" });
    return;
  }
  try {
    const composition = updateCompositionColorSettings(id, colorSettings);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

compositionsRouter.patch("/compositions/:id/opening-settings", async (req, res) => {
  const { id } = req.params;
  const { openingSettings } = req.body ?? {};
  if (!openingSettings || typeof openingSettings !== "object") {
    res.status(400).json({ error: "Body must include openingSettings: object" });
    return;
  }
  try {
    const composition = updateCompositionOpeningSettings(id, openingSettings);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

compositionsRouter.patch("/compositions/:id/closing-settings", async (req, res) => {
  const { id } = req.params;
  const { closingSettings } = req.body ?? {};
  if (!closingSettings || typeof closingSettings !== "object") {
    res.status(400).json({ error: "Body must include closingSettings: object" });
    return;
  }
  try {
    const composition = updateCompositionClosingSettings(id, closingSettings);
    res.status(200).json({ status: "completed", composition });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

/**
 * Preview 2s before + 2s after a join (faithful NVENC).
 * Body: { vodId, preset, joinIndex, segments, joinSettings, colorSettings, subtitleSettings, ... }
 */
compositionsRouter.post("/compositions/join-preview", async (req, res) => {
  const body = req.body ?? {};
  const { vodId, preset, joinIndex } = body;
  const segments = normalizePreviewSegmentsBody(body.segments);
  if (typeof vodId !== "string" || typeof preset !== "string") {
    res.status(400).json({ error: "vodId and preset required" });
    return;
  }
  if (typeof joinIndex !== "number" || joinIndex < 0) {
    res.status(400).json({ error: "joinIndex must be a non-negative number" });
    return;
  }
  if (!segments) {
    res.status(400).json({ error: "segments required" });
    return;
  }
  try {
    let offset = 0;
    const durs: number[] = [];
    for (const s of segments) {
      const cs = getClipSegmentById(s.clipSegmentId);
      const full = Math.max(0.1, cs.sourceEnd - cs.sourceStart);
      const fs = Math.max(0, s.finalStart ?? 0);
      const fe = Math.min(full, s.finalEnd ?? full);
      durs.push(fe - fs);
    }
    let joinTime = 0;
    for (let i = 0; i <= joinIndex; i++) {
      joinTime += durs[i] ?? 0;
    }
    const before = typeof body.beforeSec === "number" ? body.beforeSec : 2;
    const after = typeof body.afterSec === "number" ? body.afterSec : 2;
    const total = durs.reduce((a, b) => a + b, 0);
    const windowStart = Math.max(0, joinTime - before);
    const windowEnd = Math.min(total, joinTime + after);

    const result = await compositionPreviewRenderWindow({
      vodId,
      preset,
      segments,
      windowStart,
      windowEnd,
      joinSettings: body.joinSettings,
      colorSettings: body.colorSettings,
      subtitleSettings: body.subtitleSettings,
      segmentSubtitleInputs: body.segmentSubtitleInputs,
    });
    res.status(200).json({ status: "completed", joinTime, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

/**
 * Body: { sourceStart: number, sourceEnd: number }
 */
compositionsRouter.patch("/clip-segments/:id/interval", async (req, res) => {
  const { id } = req.params;
  const { sourceStart, sourceEnd } = req.body ?? {};
  if (typeof sourceStart !== "number" || typeof sourceEnd !== "number") {
    res.status(400).json({
      error: "Body must include sourceStart and sourceEnd as numbers",
    });
    return;
  }
  try {
    const clipSegment = await trimClipSegmentInterval(id, sourceStart, sourceEnd);
    res.status(200).json({ status: "completed", clipSegment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});

compositionsRouter.get("/clip-segments/:id/composition-usage", async (req, res) => {
  const { id } = req.params;
  try {
    getClipSegmentById(id);
    const count = countCompositionsUsingSegment(id);
    res.status(200).json({ clipSegmentId: id, compositionCount: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes("not found") ? 404 : 500).json({ error: message });
  }
});

/**
 * Body: { presetApplications: array }
 */
compositionsRouter.put(
  "/clip-segments/:id/preset-applications",
  async (req, res) => {
    const { id } = req.params;
    const { presetApplications } = req.body ?? {};
    if (!Array.isArray(presetApplications)) {
      res.status(400).json({
        error: "Body must include presetApplications: array",
      });
      return;
    }
    try {
      const clipSegment = saveClipSegmentPresetApplications(
        id,
        presetApplications
      );
      res.status(200).json({ status: "completed", clipSegment });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 400).json({
        error: message,
      });
    }
  }
);

/** Also mount clone-for-reuse here so compositions router owns Layer-3 adjacent ops. */
compositionsRouter.post(
  "/clip-segments/:id/clone-for-reuse",
  async (req, res) => {
    const { id } = req.params;
    try {
      const clipSegment = await cloneClipSegmentForReuse(id);
      res.status(200).json({
        status: "completed",
        clipSegment,
        clipSegmentId: clipSegment.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("not found")
          ? 404
          : message.includes("not marked reusable")
            ? 400
            : 500;
      res.status(status).json({ error: message });
    }
  }
);
