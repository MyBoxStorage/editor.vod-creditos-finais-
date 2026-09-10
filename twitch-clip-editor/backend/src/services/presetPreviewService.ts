import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  probeMediaDurationSeconds,
  renderProcessedPreviewSegment,
  renderWastedInsertClip,
  type ColorPresetId,
} from "./candidateExportService";
import {
  expandEmotionPreset,
  type EmotionPresetId,
} from "./emotionPresets";
import { findClipEditableById } from "./clipEditable";
import {
  ensurePreviewForInterval,
  resolveCachedPreviewDuration,
} from "./previewIntegrity";
import { resolveMarkedClipDuration } from "./clipDuration";
import { getDataDir } from "./vodIngest";

export type PreviewEmotionPresetInput = {
  presetId: EmotionPresetId;
  /** Normal presets: window start. Wasted: insertAtTime. */
  effectStart: number;
  /** Normal presets: window end. Wasted: ignored when effectDuration is set. */
  effectEnd: number;
  /** Wasted only: screen duration of inserted segment (default 6). */
  effectDuration?: number;
  intensityPercent?: number;
  layoutPresetId: string;
};

export type PreviewEmotionPresetResult = {
  cached: boolean;
  elapsedMs: number;
  previewRelativePath: string;
  previewUrlPath: string;
  windowStart: number;
  windowDuration: number;
  summary: string;
  presetId: EmotionPresetId;
  effectStart: number;
  effectEnd: number;
  intensityPercent: number;
  /** Present for wasted — expected final duration ≈ clip + effectDuration. */
  expectedDuration?: number;
};

function isEmotionPresetId(id: string): id is EmotionPresetId {
  return (
    id === "emphasis" ||
    id === "suspense" ||
    id === "celebration" ||
    id === "surprise" ||
    id === "disappointment" ||
    id === "wasted"
  );
}

function buildPresetPreviewCacheKey(input: {
  entityId: string;
  presetId: EmotionPresetId;
  effectStart: number;
  effectEnd: number;
  effectDuration?: number;
  intensityPercent: number;
  clipStart: number;
  clipEnd: number;
  layoutPresetId: string;
  previewMtimeMs: number;
}): string {
  const payload = JSON.stringify({
    v: 6,
    scope: input.presetId === "wasted" ? "wasted_inplace" : "full_clip",
    entityId: input.entityId,
    presetId: input.presetId,
    effectStart: Number(input.effectStart.toFixed(2)),
    effectEnd: Number(input.effectEnd.toFixed(2)),
    effectDuration:
      input.effectDuration != null
        ? Number(input.effectDuration.toFixed(2))
        : undefined,
    intensity: Math.round(input.intensityPercent),
    colorWindow: true,
    clipStart: Number(input.clipStart.toFixed(2)),
    clipEnd: Number(input.clipEnd.toFixed(2)),
    layout: input.layoutPresetId,
    previewMtimeMs: input.previewMtimeMs,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

/**
 * Real ffmpeg preview of an emotion preset on the ENTIRE trecho being edited.
 * Cached under data/{vodId}/previews_preset/ — does not touch export status.
 * Wasted uses in-place grading (duration = clip length).
 */
export async function previewEmotionPreset(
  entityId: string,
  input: PreviewEmotionPresetInput
): Promise<PreviewEmotionPresetResult> {
  const t0 = Date.now();

  if (!isEmotionPresetId(input.presetId)) {
    throw new Error(`Unknown emotion preset: ${input.presetId}`);
  }

  const intensityPercent = Math.max(
    0,
    Math.min(200, input.intensityPercent ?? 100)
  );
  if (typeof input.layoutPresetId !== "string" || !input.layoutPresetId) {
    throw new Error("layoutPresetId is required");
  }

  if (input.presetId === "wasted") {
    if (typeof input.effectStart !== "number" || !(input.effectStart >= 0)) {
      throw new Error("Wasted requires effectStart (insertAtTime) as a number ≥ 0");
    }
    const effectDuration =
      typeof input.effectDuration === "number" && input.effectDuration > 0
        ? input.effectDuration
        : 6;
    if (!(effectDuration >= 0.5)) {
      throw new Error("Wasted effectDuration must be ≥ 0.5 seconds");
    }
  } else if (
    typeof input.effectStart !== "number" ||
    typeof input.effectEnd !== "number" ||
    !(input.effectEnd > input.effectStart)
  ) {
    throw new Error("effectStart and effectEnd must be numbers with end > start");
  }

  let editable = await findClipEditableById(entityId);
  const vodId = editable.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const { previewPath, editable: refreshed } = await ensurePreviewForInterval(
    entityId,
    editable.start,
    editable.end
  );
  editable = refreshed;

  const previewStat = await fs.stat(previewPath);
  const markedDuration = Math.max(0.1, editable.end - editable.start);
  const probedDuration = await resolveCachedPreviewDuration(
    previewPath,
    markedDuration
  );
  const { clipDuration } = resolveMarkedClipDuration(
    markedDuration,
    probedDuration
  );

  const wastedDuration =
    input.presetId === "wasted"
      ? typeof input.effectDuration === "number" && input.effectDuration > 0
        ? input.effectDuration
        : 6
      : undefined;

  const expanded = expandEmotionPreset({
    presetId: input.presetId,
    effectStart: input.effectStart,
    effectEnd:
      input.presetId === "wasted"
        ? input.effectStart + (wastedDuration ?? 6)
        : input.effectEnd,
    effectDuration: wastedDuration,
    clipDuration,
    intensityPercent,
  });

  const cacheKey = buildPresetPreviewCacheKey({
    entityId,
    presetId: input.presetId,
    effectStart: expanded.effectStart,
    effectEnd: expanded.effectEnd,
    effectDuration:
      input.presetId === "wasted" && input.effectDuration != null
        ? Number(input.effectDuration.toFixed(2))
        : undefined,
    intensityPercent: expanded.intensityPercent,
    clipStart: editable.start,
    clipEnd: editable.end,
    layoutPresetId: input.layoutPresetId,
    previewMtimeMs: previewStat.mtimeMs,
  });

  const presetDir = path.join(vodDir, "previews_preset");
  await fs.mkdir(presetDir, { recursive: true });
  const fileName = `${entityId}_${cacheKey}.mp4`;
  const outputPath = path.join(presetDir, fileName);
  const previewRelativePath = `previews_preset/${fileName}`;

  let cached = false;
  try {
    const existing = await fs.stat(outputPath);
    if (existing.size > 0) {
      cached = true;
    }
  } catch {
    cached = false;
  }

  let expectedDuration = clipDuration;
  if (!cached) {
    if (input.presetId === "wasted") {
      const effectDuration = Math.max(
        0.5,
        expanded.effectEnd - expanded.effectStart
      );
      await renderWastedInsertClip({
        previewPath,
        clipDuration,
        insertAtTime: expanded.effectStart,
        effectDuration,
        intensityPercent: expanded.intensityPercent,
        layoutPresetId: input.layoutPresetId,
        quality: "draft",
        outputPath,
        workDir: path.join(presetDir, `.work_${cacheKey}`),
      });
      expectedDuration = clipDuration;
    } else {
      await renderProcessedPreviewSegment({
        previewPath,
        segmentStart: 0,
        segmentDuration: clipDuration,
        layoutPresetId: input.layoutPresetId,
        quality: "draft",
        zoomKeyframes: expanded.zoomKeyframes,
        speedRamp: expanded.speedRamp ?? undefined,
        speed: 1,
        colorPreset: expanded.colorPreset as ColorPresetId,
        colorIntensityPercent: expanded.intensityPercent,
        colorEffectStart: expanded.effectStart,
        colorEffectEnd: expanded.effectEnd,
        colorFadeSeconds:
          input.presetId === "emphasis" || input.presetId === "surprise"
            ? 0
            : undefined,
        outputPath,
        fullClip: true,
      });
    }
  }

  const probedOut = await probeMediaDurationSeconds(outputPath);

  return {
    cached,
    elapsedMs: Date.now() - t0,
    previewRelativePath,
    previewUrlPath: `/media/${vodId}/${previewRelativePath}`,
    windowStart: 0,
    windowDuration: Number((probedOut ?? expectedDuration).toFixed(3)),
    summary: expanded.summary,
    presetId: input.presetId,
    effectStart: expanded.effectStart,
    effectEnd: expanded.effectEnd,
    intensityPercent: expanded.intensityPercent,
    expectedDuration:
      input.presetId === "wasted" ? Number(expectedDuration.toFixed(3)) : undefined,
  };
}
