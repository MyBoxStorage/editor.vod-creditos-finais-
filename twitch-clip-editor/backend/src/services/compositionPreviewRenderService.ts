import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getLayoutPreset } from "../pipeline/layoutPresets";
import { runFfmpeg, runFfmpegWithFilterComplex } from "../pipeline/clipRenderer";
import { getDataDir } from "./vodIngest";
import { getQualityPreset } from "./qualityPresets";
import { getClipSegmentById } from "./clipSegmentsService";
import { loadEffectsForExport } from "./effectsLibraryService";
import type { PresetApplicationPayload } from "./candidateExportService";
import {
  buildUnifiedCompositionGraph,
  resolveCompositionDimensions,
} from "./unifiedCompositionFilterGraph";
import {
  parseCompositionJoinSettings,
} from "./compositionJoinSettings";
import {
  parseCompositionColorSettings,
} from "./compositionColorSettings";
import {
  parseCompositionOpeningSettings,
} from "./compositionOpeningSettings";
import {
  parseCompositionClosingSettings,
} from "./compositionClosingSettings";
import type { CompositionRenderOptions } from "./compositionRenderContext";
import {
  buildSubtitlesFilter,
  writeCompositionSubtitlesAss,
} from "./compositionSubtitleBurn";
import type { SubtitleSettings } from "./transcribeService";

export type CompositionPreviewSegmentInput = {
  clipSegmentId: string;
  finalStart?: number;
  finalEnd?: number;
  presetApplications?: PresetApplicationPayload[];
};

export type CompositionPreviewRenderInput = {
  vodId: string;
  segments: CompositionPreviewSegmentInput[];
  preset: string;
  speed?: number;
  windowStart: number;
  windowEnd: number;
} & CompositionRenderOptions;

export type CompositionPreviewRenderResult = {
  cached: boolean;
  elapsedMs: number;
  previewRelativePath: string;
  previewUrlPath: string;
  windowStart: number;
  windowEnd: number;
  windowDuration: number;
  cacheKey: string;
};

type ResolvedSegment = {
  clipSegmentId: string;
  vodStart: number;
  duration: number;
  timelineOffset: number;
  presetApplications?: PresetApplicationPayload[];
};

function resolveSegments(input: CompositionPreviewRenderInput): ResolvedSegment[] {
  const out: ResolvedSegment[] = [];
  let timelineOffset = 0;
  for (const seg of input.segments) {
    const clipSeg = getClipSegmentById(seg.clipSegmentId);
    const fullDur = Math.max(0.1, clipSeg.sourceEnd - clipSeg.sourceStart);
    const fs = Math.max(0, seg.finalStart ?? 0);
    const fe = Math.min(fullDur, seg.finalEnd ?? fullDur);
    const duration = fe - fs;
    out.push({
      clipSegmentId: seg.clipSegmentId,
      vodStart: clipSeg.sourceStart + fs,
      duration,
      timelineOffset,
      presetApplications: seg.presetApplications,
    });
    timelineOffset += duration;
  }
  return out;
}

function buildCompositionPreviewCacheKey(input: {
  body: CompositionPreviewRenderInput;
  totalDuration: number;
}): string {
  const payload = JSON.stringify({
    v: 1,
    vodId: input.body.vodId,
    preset: input.body.preset,
    speed: input.body.speed ?? 1,
    windowStart: Number(input.body.windowStart.toFixed(3)),
    windowEnd: Number(input.body.windowEnd.toFixed(3)),
    totalDuration: Number(input.totalDuration.toFixed(3)),
    segments: input.body.segments.map((s) => ({
      id: s.clipSegmentId,
      finalStart: s.finalStart ?? 0,
      finalEnd: s.finalEnd ?? null,
      presetApplications: s.presetApplications ?? null,
    })),
    joinSettings: input.body.joinSettings ?? null,
    colorSettings: input.body.colorSettings ?? null,
    openingSettings: input.body.openingSettings ?? null,
    closingSettings: input.body.closingSettings ?? null,
    subtitleSettings: input.body.subtitleSettings ?? null,
    burnSubtitles: input.body.burnSubtitles ?? true,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

/**
 * Faithful NVENC preview for a window on the composed clip timeline (contract §20.2).
 */
export async function compositionPreviewRenderWindow(
  input: CompositionPreviewRenderInput
): Promise<CompositionPreviewRenderResult> {
  const t0 = Date.now();

  if (
    typeof input.windowStart !== "number" ||
    typeof input.windowEnd !== "number" ||
    !(input.windowEnd > input.windowStart)
  ) {
    throw new Error("windowStart and windowEnd must be numbers with end > start");
  }

  const layout = getLayoutPreset(input.preset);
  if (!layout) {
    throw new Error(`Unknown layout preset: ${input.preset}`);
  }
  const quality = getQualityPreset("draft");
  if (!quality) {
    throw new Error("draft quality preset missing");
  }

  const resolved = resolveSegments(input);
  const totalDuration = resolved.reduce((s, r) => s + r.duration, 0);
  const windowStart = Math.max(0, Math.min(input.windowStart, totalDuration));
  const windowEnd = Math.max(
    windowStart + 0.1,
    Math.min(input.windowEnd, totalDuration)
  );
  const windowDuration = windowEnd - windowStart;

  const cacheKey = buildCompositionPreviewCacheKey({
    body: { ...input, windowStart, windowEnd },
    totalDuration,
  });

  const vodDir = path.join(getDataDir(), input.vodId);
  const renderDir = path.join(vodDir, "previews_render");
  await fs.mkdir(renderDir, { recursive: true });
  const fileName = `composition_${cacheKey}.mp4`;
  const outputPath = path.join(renderDir, fileName);

  let cached = false;
  try {
    const st = await fs.stat(outputPath);
    if (st.size > 0) cached = true;
  } catch {
    cached = false;
  }

  if (!cached) {
    const sourcePath = path.join(vodDir, "source.mp4");
    const dims = resolveCompositionDimensions(layout, quality.resolutionScale);
    const speed = typeof input.speed === "number" && input.speed > 0 ? input.speed : 1;

    // Include only segments overlapping the preview window
    const graphSegments: Parameters<typeof buildUnifiedCompositionGraph>[0]["segments"] =
      [];
    let composedOffset = 0;

    for (const seg of resolved) {
      const segStart = composedOffset;
      const segEnd = composedOffset + seg.duration;
      composedOffset = segEnd;

      const overlapStart = Math.max(segStart, windowStart);
      const overlapEnd = Math.min(segEnd, windowEnd);
      if (overlapEnd <= overlapStart) continue;

      const localStart = overlapStart - segStart;
      const localEnd = overlapEnd - segStart;
      const trimDur = localEnd - localStart;
      const clipSeg = getClipSegmentById(seg.clipSegmentId);
      const vodStart = seg.vodStart + localStart;
      const materialStart =
        clipSeg.originalSourceStart ?? clipSeg.sourceStart;
      const materialEnd = clipSeg.originalSourceEnd ?? clipSeg.sourceEnd;

      graphSegments.push({
        vodStart,
        duration: trimDur,
        sourceBounds: {
          vodStart,
          vodEnd: vodStart + trimDur,
          materialStart,
          materialEnd,
        },
        layout,
        outW: dims.outW,
        outH: dims.outH,
        zoomW: dims.zoomW,
        zoomH: dims.zoomH,
        resolutionScale: quality.resolutionScale,
        speed,
        presetApplications: shiftPresetApplicationsForWindow(
          seg.presetApplications,
          localStart,
          trimDur
        ),
        effects: shiftEffectsForWindow(
          loadEffectsForExport(seg.clipSegmentId),
          localStart,
          trimDur
        ),
      });
    }

    if (graphSegments.length === 0) {
      throw new Error("Preview window does not overlap any segment");
    }

    const workDir = path.join(renderDir, `.work_${cacheKey}`);
    await fs.mkdir(workDir, { recursive: true });

    let subtitlesFilter: string | null = null;
    if (input.burnSubtitles !== false && input.subtitleSettings) {
      const assPath = await writeCompositionSubtitlesAss({
        vodId: input.vodId,
        workDir,
        segmentInputs: input.segmentSubtitleInputs ?? [],
        subtitleSettings: input.subtitleSettings as SubtitleSettings,
        totalDurationSec: totalDuration,
        layoutPresetId: input.preset,
      });
      if (assPath) subtitlesFilter = buildSubtitlesFilter(assPath);
    }

    const graph = buildUnifiedCompositionGraph({
      sourcePath,
      segments: graphSegments,
      joinSettings: parseCompositionJoinSettings(input.joinSettings),
      colorSettings: parseCompositionColorSettings(input.colorSettings),
      openingSettings: parseCompositionOpeningSettings(input.openingSettings),
      closingSettings: parseCompositionClosingSettings(input.closingSettings),
      vodId: input.vodId,
      subtitlesFilter,
    });

    const rawPath = path.join(workDir, "raw.mp4");

    await runFfmpegWithFilterComplex({
      inputArgs: graph.ffmpegArgs,
      filterComplex: graph.filterComplex,
      outputArgs: [
        "-map",
        `[${graph.videoOutLabel}]`,
        "-map",
        `[${graph.audioOutLabel}]`,
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "ll",
        "-cq",
        String(Math.min(quality.crf + 6, 32)),
        "-c:a",
        "aac",
        "-b:a",
        quality.audioBitrate,
        "-movflags",
        "+faststart",
        rawPath,
      ],
      scriptDir: workDir,
    });

    await fs.copyFile(rawPath, outputPath);
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return {
    cached,
    elapsedMs: Date.now() - t0,
    previewRelativePath: `previews_render/${fileName}`,
    previewUrlPath: `/media/${input.vodId}/previews_render/${fileName}`,
    windowStart,
    windowEnd,
    windowDuration: Number(windowDuration.toFixed(3)),
    cacheKey,
  };
}

function shiftPresetApplicationsForWindow(
  apps: PresetApplicationPayload[] | undefined,
  windowLocalStart: number,
  windowDuration: number
): PresetApplicationPayload[] | undefined {
  if (!apps?.length) return undefined;
  const windowEnd = windowLocalStart + windowDuration;
  return apps
    .filter((a) => a.effectEnd > windowLocalStart && a.effectStart < windowEnd)
    .map((a) => ({
      ...a,
      effectStart: Math.max(0, a.effectStart - windowLocalStart),
      effectEnd: Math.min(windowDuration, a.effectEnd - windowLocalStart),
      colorEffectStart:
        a.colorEffectStart != null
          ? Math.max(0, a.colorEffectStart - windowLocalStart)
          : undefined,
      colorEffectEnd:
        a.colorEffectEnd != null
          ? Math.min(windowDuration, a.colorEffectEnd - windowLocalStart)
          : undefined,
      zoomKeyframes: a.zoomKeyframes
        ?.map((k) => ({ ...k, time: k.time - windowLocalStart }))
        .filter((k) => k.time <= windowDuration + 0.001),
      speedRamp: a.speedRamp
        ?.map((p) => ({ ...p, time: p.time - windowLocalStart }))
        .filter((p) => p.time <= windowDuration + 0.001),
    }));
}

function shiftEffectsForWindow(
  effects: ReturnType<typeof loadEffectsForExport>,
  windowLocalStart: number,
  windowDuration: number
) {
  return effects
    .map((row) => {
      const inst = row.instance;
      const partStart = inst.sourceTrimStart ?? 0;
      const partEnd = inst.sourceTrimEnd ?? partStart + 1;
      const partDur = Math.max(0.05, partEnd - partStart);
      const clipTs = inst.clipTimestamp ?? 0;
      const relStart = clipTs - windowLocalStart;
      if (relStart + partDur <= 0 || relStart >= windowDuration) return null;
      return {
        ...row,
        instance: {
          ...inst,
          clipTimestamp: Number(Math.max(0, relStart).toFixed(3)),
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}
