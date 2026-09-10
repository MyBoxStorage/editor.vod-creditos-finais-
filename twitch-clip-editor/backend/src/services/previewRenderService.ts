import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  renderFaithfulPreviewWindow,
  type ExportCandidateInput,
  type PresetApplicationPayload,
  normalizeZoomKeyframes,
  normalizeSpeedRamp,
  normalizeColorEffectTiming,
  colorPresetFilterExpr,
  type ColorPresetId,
} from "./candidateExportService";
import { findClipEditableById } from "./clipEditable";
import {
  ensurePreviewForInterval,
  resolveCachedPreviewDuration,
} from "./previewIntegrity";
import { resolveMarkedClipDuration } from "./clipDuration";
import { getDataDir } from "./vodIngest";
import type { SubtitleRenderSnapshot } from "./transcribeService";

export type PreviewRenderInput = ExportCandidateInput & {
  windowStart: number;
  windowEnd: number;
  /** Transcript file mtime for cache busting on save/resync. */
  transcriptMtimeMs?: number;
};

export type PreviewRenderResult = {
  cached: boolean;
  elapsedMs: number;
  previewRelativePath: string;
  previewUrlPath: string;
  windowStart: number;
  windowEnd: number;
  windowDuration: number;
  /** Hook concat omitted from faithful preview (Sprint 11). */
  excludedHook?: boolean;
  /** Wasted insert omitted from faithful preview (Sprint 11). */
  excludedWasted?: boolean;
};

function hasHookRange(body: PreviewRenderInput): boolean {
  return (
    typeof body.hookStart === "number" && typeof body.hookEnd === "number"
  );
}

function mergeInPlaceAppsForPreview(
  apps: PresetApplicationPayload[]
): Pick<
  ExportCandidateInput,
  | "zoomKeyframes"
  | "speedRamp"
  | "colorPreset"
  | "colorEffectStart"
  | "colorEffectEnd"
  | "colorIntensityPercent"
> & { extraColorFilters?: string[] } {
  const sorted = [...apps].sort((a, b) => a.effectStart - b.effectStart);
  const allZoom: NonNullable<ExportCandidateInput["zoomKeyframes"]> = [];
  const allSpeed: NonNullable<ExportCandidateInput["speedRamp"]> = [];
  const extraColorFilters: string[] = [];

  for (const app of sorted) {
    const zk = normalizeZoomKeyframes(app.zoomKeyframes);
    if (zk) allZoom.push(...zk);
    const sr = normalizeSpeedRamp(app.speedRamp);
    if (sr) allSpeed.push(...sr);
    const cp = (app.colorPreset ?? "none") as ColorPresetId;
    if (cp !== "none") {
      const timing = normalizeColorEffectTiming(
        app.colorEffectStart ?? app.effectStart,
        app.colorEffectEnd ?? app.effectEnd,
        app.colorFadeSeconds
      );
      const f = colorPresetFilterExpr(cp, app.intensityPercent ?? 100, timing);
      if (f) extraColorFilters.push(f);
    }
  }

  return {
    zoomKeyframes: normalizeZoomKeyframes(allZoom) ?? undefined,
    speedRamp: normalizeSpeedRamp(allSpeed) ?? undefined,
    colorPreset: "none",
    extraColorFilters,
  };
}

/** Preview window render never concatenates hook. Wasted is in-place. */
function bodyForFaithfulWindowRender(body: PreviewRenderInput): {
  renderBody: PreviewRenderInput;
  excludedHook: boolean;
  extraColorFilters: string[];
} {
  const excludedHook = hasHookRange(body);
  let extraColorFilters: string[] = [];

  const apps = body.presetApplications;
  if (apps && apps.length >= 1) {
    const merged = mergeInPlaceAppsForPreview(apps);
    extraColorFilters = merged.extraColorFilters ?? [];
    const {
      wastedInsert: _w,
      hookStart: _hs,
      hookEnd: _he,
      presetApplications: _pa,
      ...rest
    } = body;
    return {
      renderBody: {
        ...rest,
        zoomKeyframes: merged.zoomKeyframes,
        speedRamp: merged.speedRamp,
        colorPreset: "none",
        colorEffectStart: undefined,
        colorEffectEnd: undefined,
        colorFadeSeconds: undefined,
      } as PreviewRenderInput,
      excludedHook,
      extraColorFilters,
    };
  }

  const { hookStart: _hs, hookEnd: _he, ...rest } = body;
  return {
    renderBody: rest as PreviewRenderInput,
    excludedHook,
    extraColorFilters,
  };
}

function buildPreviewRenderCacheKey(input: {
  candidateId: string;
  clipStart: number;
  clipEnd: number;
  previewMtimeMs: number;
  transcriptMtimeMs: number | null;
  body: PreviewRenderInput;
}): string {
  const snap = input.body.subtitleSnapshot ?? null;
  const payload = JSON.stringify({
    v: 2,
    candidateId: input.candidateId,
    clipStart: Number(input.clipStart.toFixed(3)),
    clipEnd: Number(input.clipEnd.toFixed(3)),
    previewMtimeMs: input.previewMtimeMs,
    transcriptMtimeMs: input.transcriptMtimeMs,
    windowStart: Number(input.body.windowStart.toFixed(3)),
    windowEnd: Number(input.body.windowEnd.toFixed(3)),
    export: {
      useSubtitles: input.body.useSubtitles,
      subtitleRange: input.body.subtitleRange,
      subtitleSnapshot: snap,
      quality: input.body.quality,
      speed: input.body.speed,
      preset: input.body.preset,
      zoomKeyframes: input.body.zoomKeyframes ?? null,
      speedRamp: input.body.speedRamp ?? null,
      colorPreset: input.body.colorPreset ?? "none",
      colorIntensityPercent: input.body.colorIntensityPercent ?? 100,
      colorEffectStart: input.body.colorEffectStart ?? null,
      colorEffectEnd: input.body.colorEffectEnd ?? null,
      colorFadeSeconds: input.body.colorFadeSeconds ?? null,
      hookStart: input.body.hookStart ?? null,
      hookEnd: input.body.hookEnd ?? null,
      wastedInsert: input.body.wastedInsert ?? null,
      presetApplications: input.body.presetApplications ?? null,
    },
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

/**
 * Faithful NVENC preview for a clip-relative window.
 * Cached under data/{vodId}/previews_render/ — separate from previews/ and previews_preset/.
 */
export async function previewRenderWindow(
  candidateId: string,
  body: PreviewRenderInput
): Promise<PreviewRenderResult> {
  const t0 = Date.now();

  if (
    typeof body.windowStart !== "number" ||
    typeof body.windowEnd !== "number" ||
    !(body.windowEnd > body.windowStart)
  ) {
    throw new Error("windowStart and windowEnd must be numbers with end > start");
  }

  const { renderBody, excludedHook, extraColorFilters } =
    bodyForFaithfulWindowRender(body);

  let editable = await findClipEditableById(candidateId);
  const vodId = editable.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const { previewPath, editable: refreshed } = await ensurePreviewForInterval(
    candidateId,
    editable.start,
    editable.end
  );
  editable = refreshed;

  const previewStat = await fs.stat(previewPath);
  let transcriptMtimeMs: number | null = null;
  const transcriptPath = path.join(
    vodDir,
    editable.clipTranscriptRelativePath ?? `transcripts/${candidateId}.json`
  );
  try {
    const transcriptStat = await fs.stat(transcriptPath);
    transcriptMtimeMs = transcriptStat.mtimeMs;
  } catch {
    transcriptMtimeMs = null;
  }

  const markedDuration = Math.max(0.1, editable.end - editable.start);
  const probedDuration = await resolveCachedPreviewDuration(
    previewPath,
    markedDuration
  );
  const { clipDuration } = resolveMarkedClipDuration(
    markedDuration,
    probedDuration
  );

  const windowStart = Math.max(0, Math.min(body.windowStart, clipDuration));
  const windowEnd = Math.max(
    windowStart + 0.1,
    Math.min(body.windowEnd, clipDuration)
  );

  const cacheKey = buildPreviewRenderCacheKey({
    candidateId,
    clipStart: editable.start,
    clipEnd: editable.end,
    previewMtimeMs: previewStat.mtimeMs,
    transcriptMtimeMs,
    body: { ...renderBody, windowStart, windowEnd },
  });

  const renderDir = path.join(vodDir, "previews_render");
  await fs.mkdir(renderDir, { recursive: true });
  const fileName = `${candidateId}_${cacheKey}.mp4`;
  const outputPath = path.join(renderDir, fileName);
  const previewRelativePath = `previews_render/${fileName}`;

  let cached = false;
  try {
    const existing = await fs.stat(outputPath);
    if (existing.size > 0) cached = true;
  } catch {
    cached = false;
  }

  if (!cached) {
    await renderFaithfulPreviewWindow({
      ...renderBody,
      windowStart,
      windowEnd,
      candidateId,
      previewPath,
      clipDuration,
      outputPath,
      workDir: path.join(renderDir, `.work_${cacheKey}`),
      extraColorFilters,
    });
  }

  const windowDuration = Number((windowEnd - windowStart).toFixed(3));

  return {
    cached,
    elapsedMs: Date.now() - t0,
    previewRelativePath,
    previewUrlPath: `/media/${vodId}/${previewRelativePath}`,
    windowStart,
    windowEnd,
    windowDuration,
    ...(excludedHook ? { excludedHook: true } : {}),
  };
}
