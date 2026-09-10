import { Router } from "express";
import path from "path";
import { trimPreview } from "../services/trimPreviewService";
import {
  saveClipTranscript,
  transcribeClip,
  resyncClipSegment,
  loadGlossary,
  saveGlossary,
} from "../services/clipTranscribeService";
import { exportCandidate } from "../services/candidateExportService";
import type { PresetApplicationPayload } from "../services/candidateExportService";
import { previewEmotionPreset } from "../services/presetPreviewService";
import { previewRenderWindow } from "../services/previewRenderService";
import { mergeCandidates } from "../services/candidateMergeService";
import { getOrCreateCandidateThumbnail } from "../services/candidateThumbnailService";
import { toggleClipSegmentReusable } from "../services/clipSegmentsService";
import type { QualityId } from "../services/qualityPresets";
import {
  applyEffectToClip,
  listEffectsForClip,
  removeEffectFromClip,
  updateEffectOnClip,
} from "../services/effectsLibraryService";

import { humanizeApiError } from "../utils/previewFileErrors.js";

export const candidatesRouter = Router();

function normalizePresetApplicationsBody(
  raw: unknown
): PresetApplicationPayload[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1) return undefined;
  const apps: PresetApplicationPayload[] = [];
  for (const row of raw) {
    if (
      !row ||
      typeof row.presetId !== "string" ||
      typeof row.effectStart !== "number" ||
      typeof row.effectEnd !== "number" ||
      typeof row.intensityPercent !== "number"
    ) {
      throw new Error(
        "presetApplications entries must include presetId, effectStart, effectEnd, intensityPercent"
      );
    }
    const duration =
      row.presetId === "wasted" && typeof row.effectDuration === "number"
        ? row.effectDuration
        : row.effectEnd - row.effectStart;
    if (!(duration >= 0.5)) {
      throw new Error(
        "Preset application duration must be ≥ 0.5 seconds"
      );
    }
    apps.push({
      presetId: row.presetId,
      effectStart: row.effectStart,
      effectEnd: row.effectEnd,
      effectDuration:
        typeof row.effectDuration === "number" ? row.effectDuration : undefined,
      intensityPercent: row.intensityPercent,
      zoomKeyframes: Array.isArray(row.zoomKeyframes)
        ? row.zoomKeyframes
        : undefined,
      speedRamp: Array.isArray(row.speedRamp) ? row.speedRamp : undefined,
      colorPreset: row.colorPreset,
      colorEffectStart:
        typeof row.colorEffectStart === "number"
          ? row.colorEffectStart
          : undefined,
      colorEffectEnd:
        typeof row.colorEffectEnd === "number" ? row.colorEffectEnd : undefined,
      colorFadeSeconds:
        typeof row.colorFadeSeconds === "number"
          ? row.colorFadeSeconds
          : undefined,
    });
  }
  return apps;
}

/**
 * Body: { isReusable: boolean, reusableName?: string, tags?: string[] }
 * Persist reusable flag on a clip_segment (Layer 2 library marker).
 */
candidatesRouter.post(
  "/clip-segments/:id/toggle-reusable",
  async (req, res) => {
    const { id } = req.params;
    const { isReusable, reusableName, tags } = req.body ?? {};

    if (typeof isReusable !== "boolean") {
      res.status(400).json({
        error: "Body must include isReusable: boolean",
      });
      return;
    }

    let tagsArg: string[] | undefined;
    if (Array.isArray(tags)) {
      tagsArg = tags.filter((t): t is string => typeof t === "string");
    }

    try {
      const segment = toggleClipSegmentReusable(
        id,
        isReusable,
        typeof reusableName === "string" ? reusableName : undefined,
        tagsArg
      );
      res.status(200).json({
        status: "completed",
        clipSegment: segment,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: humanizeApiError(message) });
    }
  }
);

/**
 * Body: { candidateIds: string[], quality: "draft" | "hd" | "max" }
 * Concat exported finals only → prontos/{runId}/merged_{timestamp}.mp4
 * Registered before /:id routes so "merge" is never treated as an id.
 */
candidatesRouter.post("/candidates/merge", async (req, res) => {
  const body = req.body ?? {};
  const { candidateIds, quality } = body;

  if (quality !== "draft" && quality !== "hd" && quality !== "max") {
    res.status(400).json({
      error:
        'Body must include quality: "draft" | "hd" | "max" (required, no default)',
    });
    return;
  }
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    res.status(400).json({
      error: "Body must include candidateIds: non-empty string[]",
    });
    return;
  }

  try {
    const result = await mergeCandidates({
      candidateIds,
      quality: quality as QualityId,
    });
    res.status(200).json({
      status: "completed",
      vodId: result.vodId,
      runId: result.runId,
      candidateIds: result.candidateIds,
      quality,
      targetResolution: result.targetResolution,
      normalized: result.normalized,
      prontosPath: result.prontosPath,
      prontosRelativePath: result.prontosRelativePath,
      elapsedMs: result.elapsedMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("Invalid candidates") ||
      message.includes("must belong") ||
      message.includes("must be") ||
      message.includes("Invalid quality")
        ? 400
        : message.includes("not found")
          ? 404
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Midpoint frame for a marked candidate → thumbnails/{id}.jpg (cached).
 * Serves the JPEG directly; file also available at /media/{vodId}/thumbnails/{id}.jpg
 */
candidatesRouter.get("/candidates/:id/thumbnail", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await getOrCreateCandidateThumbnail(id);
    res.type("jpg");
    res.sendFile(path.resolve(result.thumbPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Body: { start: number, end: number }
 * Raw ffmpeg cut → data/{vodId}/previews/{id}.mp4 (no captions / no layout).
 */
candidatesRouter.post("/candidates/:id/trim-preview", async (req, res) => {
  const { id } = req.params;
  const { start, end } = req.body ?? {};

  if (typeof start !== "number" || typeof end !== "number") {
    res.status(400).json({
      error: "Body must include { start: number, end: number }",
    });
    return;
  }

  req.setTimeout(45 * 60 * 1000);
  if (req.socket) {
    req.socket.setTimeout(45 * 60 * 1000);
  }

  try {
    const result = await trimPreview(id, start, end);
    res.status(200).json({
      status: "completed",
      candidateId: id,
      vodId: result.candidate.vodId,
      start: result.candidate.start,
      end: result.candidate.end,
      originalStart: result.candidate.originalStart,
      originalEnd: result.candidate.originalEnd,
      candidateStatus: result.candidate.status,
      previewPath: result.previewPath,
      previewUrlPath: result.previewUrlPath,
      usedCopy: result.usedCopy,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : message.includes("Trecho muito longo")
          ? 400
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Isolated Whisper on previews/{id}.mp4 only.
 * Writes transcripts/{id}.json|.ass|.srt — never touches VOD transcript.json.
 * Optional body: { layoutPresetId?: string } for ASS styling.
 */
candidatesRouter.post("/candidates/:id/transcribe-clip", async (req, res) => {
  const { id } = req.params;
  const layoutPresetId =
    req.body && typeof req.body.layoutPresetId === "string"
      ? req.body.layoutPresetId
      : undefined;

  try {
    const result = await transcribeClip(id, { layoutPresetId });
    res.status(200).json({
      status: "completed",
      candidateId: id,
      vodId: result.candidate.vodId,
      candidateStatus: result.candidate.status,
      transcriptPath: result.transcriptPath,
      assPath: result.assPath,
      srtPath: result.srtPath,
      wavPath: result.wavPath,
      segmentCount: result.transcript.segments.length,
      transcript: result.transcript,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Body: { segments: [{ index, text, highlightedWordIndices? }, ...], subtitle?: {...} }
 */
candidatesRouter.post("/candidates/:id/save-transcript", async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const segments = body.segments;
  const subtitle = body.subtitle;

  if (!Array.isArray(segments)) {
    res.status(400).json({
      error: "Body must include segments: [{ index: number, text: string }, ...]",
    });
    return;
  }

  try {
    const result = await saveClipTranscript(id, segments, {
      subtitle: subtitle && typeof subtitle === "object" ? subtitle : undefined,
    });
    res.status(200).json({
      status: "completed",
      candidateId: id,
      vodId: result.candidate.vodId,
      candidateStatus: result.candidate.status,
      isManuallyEdited: true,
      transcriptPath: result.transcriptPath,
      assPath: result.assPath,
      srtPath: result.srtPath,
      segmentCount: result.transcript.segments.length,
      transcript: result.transcript,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : message.includes("mismatch") ||
            message.includes("out of range") ||
            message.includes("duplicate") ||
            message.includes("must") ||
            message.includes("Body must") ||
            message.includes("integer") ||
            message.includes("cover every")
          ? 400
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

candidatesRouter.post("/candidates/:id/resync-segment", async (req, res) => {
  const { id } = req.params;
  const segmentIndex = req.body?.segmentIndex;
  if (typeof segmentIndex !== "number" || !Number.isInteger(segmentIndex)) {
    res.status(400).json({ error: "segmentIndex must be an integer" });
    return;
  }
  try {
    const result = await resyncClipSegment(id, segmentIndex);
    res.status(200).json({
      status: "completed",
      candidateId: id,
      segmentIndex,
      transcript: result.transcript,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: humanizeApiError(message) });
  }
});

candidatesRouter.get("/glossary", async (_req, res) => {
  try {
    const glossary = await loadGlossary();
    res.json(glossary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: humanizeApiError(message) });
  }
});

candidatesRouter.put("/glossary", async (req, res) => {
  try {
    const entries = req.body?.entries;
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: "Body must include entries: array" });
      return;
    }
    const glossary = await saveGlossary({ entries });
    res.json(glossary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: humanizeApiError(message) });
  }
});

/**
 * Body: {
 *   presetId,
 *   effectStart, effectEnd (clip-relative seconds, end > start),
 *   effectDuration?: number (Wasted only — screen duration of insert, default 6),
 *   intensityPercent?: number (0–200, default 100),
 *   layoutPresetId: string
 * }
 * Full-clip ffmpeg preview (cached under previews_preset/) — not the final export.
 */
candidatesRouter.post("/candidates/:id/preview-preset", async (req, res) => {
  const { id } = req.params;
  const {
    presetId,
    effectStart,
    effectEnd,
    effectDuration,
    intensityPercent,
    layoutPresetId,
  } = req.body ?? {};

  const validPresets = [
    "emphasis",
    "suspense",
    "celebration",
    "surprise",
    "disappointment",
    "wasted",
  ];
  if (typeof presetId !== "string" || !validPresets.includes(presetId)) {
    res.status(400).json({
      error: `Body must include presetId: ${validPresets.join(" | ")}`,
    });
    return;
  }
  if (presetId === "wasted") {
    if (typeof effectStart !== "number" || !(effectStart >= 0)) {
      res.status(400).json({
        error: "Wasted requires effectStart (insertAtTime) as a number ≥ 0",
      });
      return;
    }
    if (
      effectDuration != null &&
      (typeof effectDuration !== "number" || effectDuration < 0.5)
    ) {
      res.status(400).json({
        error: "Wasted effectDuration must be a number ≥ 0.5 when provided",
      });
      return;
    }
  } else if (typeof effectStart !== "number" || typeof effectEnd !== "number") {
    res.status(400).json({
      error: "Body must include effectStart and effectEnd as numbers",
    });
    return;
  } else if (!(effectEnd > effectStart)) {
    res.status(400).json({
      error: "effectEnd must be greater than effectStart",
    });
    return;
  }
  if (
    intensityPercent != null &&
    (typeof intensityPercent !== "number" ||
      intensityPercent < 0 ||
      intensityPercent > 200)
  ) {
    res.status(400).json({
      error: "intensityPercent must be a number between 0 and 200",
    });
    return;
  }
  if (typeof layoutPresetId !== "string" || !layoutPresetId) {
    res.status(400).json({
      error: "Body must include layoutPresetId: string",
    });
    return;
  }

  try {
    const result = await previewEmotionPreset(id, {
      presetId: presetId as
        | "emphasis"
        | "suspense"
        | "celebration"
        | "surprise"
        | "disappointment"
        | "wasted",
      effectStart,
      effectEnd:
        presetId === "wasted"
          ? effectStart +
            (typeof effectDuration === "number" ? effectDuration : 6)
          : effectEnd,
      effectDuration:
        typeof effectDuration === "number" ? effectDuration : undefined,
      intensityPercent,
      layoutPresetId,
    });
    res.status(200).json({
      status: "completed",
      candidateId: id,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") ||
      message.includes("Unknown") ||
      message.includes("must")
        ? 400
        : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Body: same fields as POST /export, plus windowStart and windowEnd (clip-relative seconds).
 * NVENC faithful preview for the window only — cached under previews_render/.
 */
candidatesRouter.post("/candidates/:id/preview-render", async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const {
    windowStart,
    windowEnd,
    useSubtitles,
    subtitleRange = null,
    quality,
    speed,
    preset,
    zoomKeyframes,
    speedRamp,
    colorPreset,
    colorIntensityPercent,
    colorEffectStart,
    colorEffectEnd,
    colorFadeSeconds,
    hookStart,
    hookEnd,
    wastedInsert,
    presetApplications,
    subtitleSnapshot,
  } = body;

  if (typeof windowStart !== "number" || typeof windowEnd !== "number") {
    res.status(400).json({
      error: "Body must include windowStart and windowEnd as numbers",
    });
    return;
  }
  if (!(windowEnd > windowStart)) {
    res.status(400).json({
      error: "windowEnd must be greater than windowStart",
    });
    return;
  }
  if (typeof useSubtitles !== "boolean") {
    res.status(400).json({ error: "Body must include useSubtitles: boolean" });
    return;
  }
  if (quality !== "draft" && quality !== "hd" && quality !== "max") {
    res.status(400).json({
      error: 'Body must include quality: "draft" | "hd" | "max"',
    });
    return;
  }
  const hasSpeedRamp = Array.isArray(speedRamp) && speedRamp.length > 0;
  if (!hasSpeedRamp && typeof speed !== "number") {
    res.status(400).json({
      error: "Body must include speed: number (or a non-empty speedRamp array)",
    });
    return;
  }
  if (typeof preset !== "string" || !preset) {
    res.status(400).json({
      error: "Body must include preset: string (layout id)",
    });
    return;
  }
  if (
    colorPreset != null &&
    colorPreset !== "none" &&
    colorPreset !== "vivid" &&
    colorPreset !== "vivid_contrast" &&
    colorPreset !== "cold_desaturated" &&
    colorPreset !== "wasted_grayscale"
  ) {
    res.status(400).json({
      error:
        'colorPreset must be "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale" when provided',
    });
    return;
  }
  if (
    colorIntensityPercent != null &&
    (typeof colorIntensityPercent !== "number" ||
      colorIntensityPercent < 0 ||
      colorIntensityPercent > 200)
  ) {
    res.status(400).json({
      error: "colorIntensityPercent must be a number between 0 and 200",
    });
    return;
  }
  if (
    (colorEffectStart != null || colorEffectEnd != null) &&
    (typeof colorEffectStart !== "number" ||
      typeof colorEffectEnd !== "number" ||
      !(colorEffectEnd > colorEffectStart))
  ) {
    res.status(400).json({
      error:
        "colorEffectStart and colorEffectEnd must both be numbers with end > start",
    });
    return;
  }
  if (
    subtitleRange != null &&
    (typeof subtitleRange !== "object" ||
      typeof subtitleRange.start !== "number" ||
      typeof subtitleRange.end !== "number")
  ) {
    res.status(400).json({
      error: "subtitleRange must be null or { start: number, end: number }",
    });
    return;
  }

  try {
    const result = await previewRenderWindow(id, {
      useSubtitles,
      subtitleRange,
      quality: quality as QualityId,
      speed: typeof speed === "number" ? speed : 1,
      preset,
      zoomKeyframes,
      speedRamp,
      colorPreset,
      colorIntensityPercent:
        typeof colorIntensityPercent === "number"
          ? colorIntensityPercent
          : undefined,
      colorEffectStart:
        typeof colorEffectStart === "number" ? colorEffectStart : undefined,
      colorEffectEnd:
        typeof colorEffectEnd === "number" ? colorEffectEnd : undefined,
      colorFadeSeconds:
        typeof colorFadeSeconds === "number" ? colorFadeSeconds : undefined,
      hookStart: typeof hookStart === "number" ? hookStart : undefined,
      hookEnd: typeof hookEnd === "number" ? hookEnd : undefined,
      wastedInsert:
        wastedInsert &&
        typeof wastedInsert.insertAtTime === "number" &&
        typeof wastedInsert.effectDuration === "number"
          ? {
              insertAtTime: wastedInsert.insertAtTime,
              effectDuration: wastedInsert.effectDuration,
              intensityPercent:
                typeof wastedInsert.intensityPercent === "number"
                  ? wastedInsert.intensityPercent
                  : undefined,
            }
          : undefined,
      presetApplications: normalizePresetApplicationsBody(presetApplications),
      subtitleSnapshot:
        subtitleSnapshot &&
        typeof subtitleSnapshot === "object" &&
        subtitleSnapshot.settings &&
        Array.isArray(subtitleSnapshot.segments)
          ? subtitleSnapshot
          : undefined,
      windowStart,
      windowEnd,
    });
    res.status(200).json({
      status: "completed",
      candidateId: id,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : message.includes("Invalid") ||
            message.includes("Unknown layout") ||
            message.includes("must be") ||
            message.includes("not supported")
          ? 400
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * Body: {
 *   useSubtitles: boolean,
 *   subtitleRange: { start, end } | null,
 *   quality: "draft" | "hd" | "max",
 *   speed: number,  // required unless speedRamp is a non-empty array
 *   preset: layout preset id,
 *   zoomKeyframes?: { time, scale, x, y }[],
 *   speedRamp?: { time, speed }[],
 *   colorPreset?: "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale",
 *   colorIntensityPercent?: number (0–200),
 *   colorEffectStart?: number,  // clip-relative; with colorEffectEnd gates color
 *   colorEffectEnd?: number,
 *   colorFadeSeconds?: number,
 *   hookStart?: number,  // preview-relative seconds (with hookEnd)
 *   hookEnd?: number
 * }
 * Starts from previews/{id}.mp4 → prontos/{runId}/{id}_final.mp4
 */
candidatesRouter.post("/candidates/:id/export", async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const {
    useSubtitles,
    subtitleRange = null,
    quality,
    speed,
    preset,
    zoomKeyframes,
    speedRamp,
    colorPreset,
    colorIntensityPercent,
    colorEffectStart,
    colorEffectEnd,
    colorFadeSeconds,
    hookStart,
    hookEnd,
    wastedInsert,
    presetApplications,
    clipRange,
  } = body;

  if (typeof useSubtitles !== "boolean") {
    res.status(400).json({ error: "Body must include useSubtitles: boolean" });
    return;
  }
  if (quality !== "draft" && quality !== "hd" && quality !== "max") {
    res.status(400).json({
      error: 'Body must include quality: "draft" | "hd" | "max"',
    });
    return;
  }
  const hasSpeedRamp =
    Array.isArray(speedRamp) && speedRamp.length > 0;
  if (!hasSpeedRamp && typeof speed !== "number") {
    res.status(400).json({
      error:
        "Body must include speed: number (or a non-empty speedRamp array)",
    });
    return;
  }
  if (typeof preset !== "string" || !preset) {
    res.status(400).json({
      error: "Body must include preset: string (layout id)",
    });
    return;
  }
  if (
    colorPreset != null &&
    colorPreset !== "none" &&
    colorPreset !== "vivid" &&
    colorPreset !== "vivid_contrast" &&
    colorPreset !== "cold_desaturated" &&
    colorPreset !== "wasted_grayscale"
  ) {
    res.status(400).json({
      error:
        'colorPreset must be "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale" when provided',
    });
    return;
  }
  if (
    colorIntensityPercent != null &&
    (typeof colorIntensityPercent !== "number" ||
      colorIntensityPercent < 0 ||
      colorIntensityPercent > 200)
  ) {
    res.status(400).json({
      error: "colorIntensityPercent must be a number between 0 and 200",
    });
    return;
  }
  if (
    (colorEffectStart != null || colorEffectEnd != null) &&
    (typeof colorEffectStart !== "number" ||
      typeof colorEffectEnd !== "number" ||
      !(colorEffectEnd > colorEffectStart))
  ) {
    res.status(400).json({
      error:
        "colorEffectStart and colorEffectEnd must both be numbers with end > start",
    });
    return;
  }
  if (
    subtitleRange != null &&
    (typeof subtitleRange !== "object" ||
      typeof subtitleRange.start !== "number" ||
      typeof subtitleRange.end !== "number")
  ) {
    res.status(400).json({
      error: "subtitleRange must be null or { start: number, end: number }",
    });
    return;
  }
  if (
    (hookStart != null && typeof hookStart !== "number") ||
    (hookEnd != null && typeof hookEnd !== "number")
  ) {
    res.status(400).json({
      error: "hookStart and hookEnd must be numbers when provided",
    });
    return;
  }

  try {
    const result = await exportCandidate(id, {
      useSubtitles,
      subtitleRange,
      quality: quality as QualityId,
      speed: typeof speed === "number" ? speed : 1,
      preset,
      zoomKeyframes,
      speedRamp,
      colorPreset,
      colorIntensityPercent:
        typeof colorIntensityPercent === "number"
          ? colorIntensityPercent
          : undefined,
      colorEffectStart:
        typeof colorEffectStart === "number" ? colorEffectStart : undefined,
      colorEffectEnd:
        typeof colorEffectEnd === "number" ? colorEffectEnd : undefined,
      colorFadeSeconds:
        typeof colorFadeSeconds === "number" ? colorFadeSeconds : undefined,
      hookStart: typeof hookStart === "number" ? hookStart : undefined,
      hookEnd: typeof hookEnd === "number" ? hookEnd : undefined,
      wastedInsert:
        wastedInsert &&
        typeof wastedInsert.insertAtTime === "number" &&
        typeof wastedInsert.effectDuration === "number"
          ? {
              insertAtTime: wastedInsert.insertAtTime,
              effectDuration: wastedInsert.effectDuration,
              intensityPercent:
                typeof wastedInsert.intensityPercent === "number"
                  ? wastedInsert.intensityPercent
                  : undefined,
            }
          : undefined,
      presetApplications: normalizePresetApplicationsBody(presetApplications),
      clipRange:
        clipRange &&
        typeof clipRange.start === "number" &&
        typeof clipRange.end === "number" &&
        clipRange.end > clipRange.start
          ? { start: clipRange.start, end: clipRange.end }
          : undefined,
    });
    res.status(200).json({
      status: "completed",
      candidateId: id,
      vodId: result.candidate.vodId,
      candidateStatus: result.candidate.status,
      quality,
      speed: hasSpeedRamp ? undefined : speed,
      speedRamp: hasSpeedRamp ? speedRamp : undefined,
      zoomKeyframes: zoomKeyframes ?? undefined,
      colorPreset: colorPreset ?? undefined,
      hookStart: typeof hookStart === "number" ? hookStart : undefined,
      hookEnd: typeof hookEnd === "number" ? hookEnd : undefined,
      preset,
      useSubtitles,
      subtitleRange,
      runId: result.runId,
      prontosPath: result.prontosPath,
      prontosRelativePath: result.prontosRelativePath,
      elapsedMs: result.elapsedMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : message.includes("Invalid") ||
            message.includes("Unknown layout") ||
            message.includes("must be") ||
            message.includes("must be an array") ||
            message.includes("colorPreset") ||
            message.includes("zoomKeyframes") ||
            message.includes("speedRamp") ||
            message.includes("hook")
          ? 400
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * GET /candidates/:id/effects — list applied effects (candidate or clip_segment).
 */
candidatesRouter.get("/candidates/:id/effects", async (req, res) => {
  const { id } = req.params;
  try {
    const effects = await listEffectsForClip(id);
    res.status(200).json({ status: "ok", candidateId: id, effects });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * POST /candidates/:id/effects
 * Body: effectLibraryItemId, sourceTrimStart/End?, clipTimestamp?,
 *   video: positionX/Y/Width/Height;
 *   music: volume, fadeInSeconds, fadeOutSeconds, duckingEnabled;
 *   sfx: volume, clipTimestamp
 */
candidatesRouter.post("/candidates/:id/effects", async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  if (
    typeof body.effectLibraryItemId !== "string" ||
    !body.effectLibraryItemId
  ) {
    res.status(400).json({
      error: "Body must include effectLibraryItemId: string",
    });
    return;
  }

  try {
    const effect = await applyEffectToClip(id, {
      effectLibraryItemId: body.effectLibraryItemId,
      sourceTrimStart:
        typeof body.sourceTrimStart === "number"
          ? body.sourceTrimStart
          : undefined,
      sourceTrimEnd:
        typeof body.sourceTrimEnd === "number" ? body.sourceTrimEnd : undefined,
      clipTimestamp:
        typeof body.clipTimestamp === "number" ? body.clipTimestamp : undefined,
      positionX:
        typeof body.positionX === "number" ? body.positionX : undefined,
      positionY:
        typeof body.positionY === "number" ? body.positionY : undefined,
      positionWidth:
        typeof body.positionWidth === "number" ? body.positionWidth : undefined,
      positionHeight:
        typeof body.positionHeight === "number"
          ? body.positionHeight
          : undefined,
      volume: typeof body.volume === "number" ? body.volume : undefined,
      fadeInSeconds:
        typeof body.fadeInSeconds === "number" ? body.fadeInSeconds : undefined,
      fadeOutSeconds:
        typeof body.fadeOutSeconds === "number"
          ? body.fadeOutSeconds
          : undefined,
      duckingEnabled:
        typeof body.duckingEnabled === "boolean"
          ? body.duckingEnabled
          : undefined,
      videoLoopEnabled:
        typeof body.videoLoopEnabled === "boolean"
          ? body.videoLoopEnabled
          : undefined,
    });
    res.status(201).json({ status: "completed", candidateId: id, effect });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("candidate not found")
        ? 404
        : message.includes("must")
          ? 400
          : 500;
    res.status(status).json({ error: humanizeApiError(message) });
  }
});

/**
 * PATCH /candidates/:id/effects/:instanceId — update applied effect timing/params.
 */
candidatesRouter.patch(
  "/candidates/:id/effects/:instanceId",
  async (req, res) => {
    const { id, instanceId } = req.params;
    const body = req.body ?? {};
    try {
      const effect = await updateEffectOnClip(id, instanceId, {
        sourceTrimStart:
          typeof body.sourceTrimStart === "number"
            ? body.sourceTrimStart
            : undefined,
        sourceTrimEnd:
          typeof body.sourceTrimEnd === "number"
            ? body.sourceTrimEnd
            : undefined,
        clipTimestamp:
          typeof body.clipTimestamp === "number"
            ? body.clipTimestamp
            : undefined,
        positionX:
          typeof body.positionX === "number" ? body.positionX : undefined,
        positionY:
          typeof body.positionY === "number" ? body.positionY : undefined,
        positionWidth:
          typeof body.positionWidth === "number"
            ? body.positionWidth
            : undefined,
        positionHeight:
          typeof body.positionHeight === "number"
            ? body.positionHeight
            : undefined,
        volume: typeof body.volume === "number" ? body.volume : undefined,
        fadeInSeconds:
          typeof body.fadeInSeconds === "number"
            ? body.fadeInSeconds
            : undefined,
        fadeOutSeconds:
          typeof body.fadeOutSeconds === "number"
            ? body.fadeOutSeconds
            : undefined,
        duckingEnabled:
          typeof body.duckingEnabled === "boolean"
            ? body.duckingEnabled
            : undefined,
        videoLoopEnabled:
          typeof body.videoLoopEnabled === "boolean"
            ? body.videoLoopEnabled
            : undefined,
      });
      res.status(200).json({ status: "completed", candidateId: id, effect });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("not found") || message.includes("candidate not found")
          ? 404
          : 500;
      res.status(status).json({ error: humanizeApiError(message) });
    }
  }
);

/**
 * DELETE /candidates/:id/effects/:instanceId
 */
candidatesRouter.delete(
  "/candidates/:id/effects/:instanceId",
  async (req, res) => {
    const { id, instanceId } = req.params;
    try {
      await removeEffectFromClip(id, instanceId);
      res.status(200).json({
        status: "completed",
        candidateId: id,
        instanceId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes("not found") || message.includes("candidate not found")
          ? 404
          : 500;
      res.status(status).json({ error: humanizeApiError(message) });
    }
  }
);