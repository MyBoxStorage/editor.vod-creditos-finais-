import fs from "fs/promises";
import path from "path";
import { getLayoutPreset } from "../pipeline/layoutPresets";
import { runFfmpegWithFilterComplex } from "../pipeline/clipRenderer";
import { getCurrentRun } from "./pipelineRun";
import { getDataDir } from "./vodIngest";
import {
  getQualityPreset,
  type QualityId,
} from "./qualityPresets";
import { loadEffectsForExport } from "./effectsLibraryService";
import { getClipSegmentById } from "./clipSegmentsService";
import type { PresetApplicationPayload } from "./candidateExportService";
import {
  buildUnifiedCompositionGraph,
  resolveCompositionDimensions,
} from "./unifiedCompositionFilterGraph";
import {
  parseCompositionJoinSettings,
  type CompositionJoinSettings,
} from "./compositionJoinSettings";
import {
  parseCompositionColorSettings,
  type CompositionColorSettings,
} from "./compositionColorSettings";
import {
  parseCompositionOpeningSettings,
} from "./compositionOpeningSettings";
import {
  parseCompositionClosingSettings,
} from "./compositionClosingSettings";
import type { SubtitleSettings } from "./transcribeService";
import type { CompositionSegmentSubtitleInput } from "./compositionSubtitleRemap";
import {
  buildSubtitlesFilter,
  writeCompositionSubtitlesAss,
} from "./compositionSubtitleBurn";
import {
  loadSegmentSubtitleInput,
  type CompositionRenderOptions,
} from "./compositionRenderContext";

export type UnifiedSegmentExportInput = {
  clipSegmentId: string;
  finalStart?: number;
  finalEnd?: number;
  presetApplications?: PresetApplicationPayload[];
};

export type UnifiedCompositionExportInput = {
  vodId: string;
  segments: UnifiedSegmentExportInput[];
  quality: QualityId;
  preset: string;
  speed?: number;
  outputName?: string;
} & CompositionRenderOptions;

export type UnifiedCompositionExportResult = {
  prontosPath: string;
  prontosRelativePath: string;
  runId: string;
  elapsedMs: number;
  totalDurationSec: number;
  segmentDurations: number[];
  joinWarnings: string[];
};

function segmentDurationFromInterval(
  sourceStart: number,
  sourceEnd: number,
  finalStart: number,
  finalEnd: number | undefined
): { vodStart: number; duration: number; finalStart: number; finalEnd: number } {
  const fullDur = Math.max(0.1, sourceEnd - sourceStart);
  const fs = Math.max(0, finalStart ?? 0);
  const fe = Math.min(fullDur, finalEnd ?? fullDur);
  if (!(fe > fs)) {
    throw new Error("finalEnd must be greater than finalStart for each segment");
  }
  return {
    vodStart: sourceStart + fs,
    duration: fe - fs,
    finalStart: fs,
    finalEnd: fe,
  };
}

export async function exportUnifiedComposition(
  input: UnifiedCompositionExportInput
): Promise<UnifiedCompositionExportResult> {
  const t0 = Date.now();
  const quality = getQualityPreset(input.quality);
  if (!quality) {
    throw new Error(`Invalid quality: ${input.quality}. Use draft | hd | max`);
  }
  const layout = getLayoutPreset(input.preset);
  if (!layout) {
    throw new Error(`Unknown layout preset: ${input.preset}`);
  }
  if (!input.segments?.length) {
    throw new Error("segments must be a non-empty array");
  }

  const vodId = input.vodId;
  const vodDir = path.join(getDataDir(), vodId);
  const sourcePath = path.join(vodDir, "source.mp4");
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`source.mp4 not found for vodId=${vodId}`);
  }

  const dims = resolveCompositionDimensions(layout, quality.resolutionScale);
  const speed = typeof input.speed === "number" && input.speed > 0 ? input.speed : 1;

  const segmentDurations: number[] = [];
  const graphSegments: Parameters<typeof buildUnifiedCompositionGraph>[0]["segments"] =
    [];
  const subtitleInputs: CompositionSegmentSubtitleInput[] = [];

  for (const segIn of input.segments) {
    const clipSeg = getClipSegmentById(segIn.clipSegmentId);
    if (clipSeg.vodId !== vodId) {
      throw new Error(
        `clip_segment ${segIn.clipSegmentId} belongs to VOD ${clipSeg.vodId}, not ${vodId}`
      );
    }
    const interval = segmentDurationFromInterval(
      clipSeg.sourceStart,
      clipSeg.sourceEnd,
      segIn.finalStart ?? 0,
      segIn.finalEnd
    );
    segmentDurations.push(interval.duration);

    const materialStart =
      clipSeg.originalSourceStart ?? clipSeg.sourceStart;
    const materialEnd = clipSeg.originalSourceEnd ?? clipSeg.sourceEnd;

    graphSegments.push({
      vodStart: interval.vodStart,
      duration: interval.duration,
      sourceBounds: {
        vodStart: interval.vodStart,
        vodEnd: interval.vodStart + interval.duration,
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
      presetApplications: segIn.presetApplications,
      effects: loadEffectsForExport(segIn.clipSegmentId),
    });

    if (input.segmentSubtitleInputs?.length === input.segments.length) {
      subtitleInputs.push(
        input.segmentSubtitleInputs[subtitleInputs.length]!
      );
    } else {
      subtitleInputs.push(
        await loadSegmentSubtitleInput(
          vodId,
          segIn.clipSegmentId,
          interval.finalStart,
          interval.finalEnd
        )
      );
    }
  }

  const exportDir = path.join(vodDir, "exports");
  await fs.mkdir(exportDir, { recursive: true });
  const workDir = path.join(exportDir, `.unified_${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const joinSettings = parseCompositionJoinSettings(input.joinSettings);
  const colorSettings = parseCompositionColorSettings(input.colorSettings);
  const openingSettings = parseCompositionOpeningSettings(input.openingSettings);
  const closingSettings = parseCompositionClosingSettings(input.closingSettings);
  const burnSubtitles = input.burnSubtitles !== false;

  let subtitlesFilter: string | null = null;
  if (burnSubtitles && input.subtitleSettings) {
    const totalDur = segmentDurations.reduce((a, b) => a + b, 0);
    const assPath = await writeCompositionSubtitlesAss({
      vodId,
      workDir,
      segmentInputs: subtitleInputs,
      subtitleSettings: input.subtitleSettings as SubtitleSettings,
      totalDurationSec: totalDur,
      layoutPresetId: input.preset,
    });
    if (assPath) {
      subtitlesFilter = buildSubtitlesFilter(assPath);
    }
  }

  const graph = buildUnifiedCompositionGraph({
    sourcePath,
    segments: graphSegments,
    joinSettings,
    colorSettings,
    openingSettings,
    closingSettings,
    vodId,
    subtitlesFilter,
  });

  const localPath = path.join(workDir, "output.mp4");

  await runFfmpegWithFilterComplex({
    inputArgs: graph.ffmpegArgs,
    filterComplex: graph.filterComplex,
    outputArgs: [
      "-map",
      `[${graph.videoOutLabel}]`,
      "-map",
      `[${graph.audioOutLabel}]`,
      "-c:v",
      "libx264",
      "-crf",
      String(quality.crf),
      "-preset",
      quality.x264Preset,
      "-c:a",
      "aac",
      "-b:a",
      quality.audioBitrate,
      "-movflags",
      "+faststart",
      localPath,
    ],
    scriptDir: workDir,
  });

  const { runId } = await getCurrentRun(vodId);
  const runDir = path.join(vodDir, "prontos", runId);
  await fs.mkdir(runDir, { recursive: true });
  const fileName =
    input.outputName?.trim() || `unified_${Date.now()}_final.mp4`;
  const prontosPath = path.join(runDir, fileName);
  await fs.copyFile(localPath, prontosPath);
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

  return {
    prontosPath,
    prontosRelativePath: `prontos/${runId}/${fileName}`,
    runId,
    elapsedMs: Date.now() - t0,
    totalDurationSec: graph.totalDurationSec,
    segmentDurations,
    joinWarnings: graph.joinWarnings,
  };
}

export type { CompositionJoinSettings, CompositionColorSettings };
