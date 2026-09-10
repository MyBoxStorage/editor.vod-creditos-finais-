/**
 * Hook + closing append — single-pass filter graph (C4).
 */

import type { LayoutPreset } from "../pipeline/layoutPresets";
import {
  getEffectLibraryItemById,
  resolveEffectFilePath,
  type EffectLibraryItem,
} from "./effectsLibraryService";
import {
  buildSegmentFilterGraph,
  type SegmentGraphContext,
} from "./unifiedCompositionFilterGraph";
import type { LoadedExportEffect } from "./effectsExportFilters";
import type { PresetApplicationPayload } from "./candidateExportService";
import type { ResolvedHook } from "./compositionHookResolve";
import type { CompositionClosingSettings } from "./compositionClosingSettings";
import { DEFAULT_FADE_IN_SEC } from "./compositionClosingSettings";

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

export type BookendsGraphContext = {
  filterParts: string[];
  ffmpegArgs: string[];
  nextInputIndex: number;
  videoOutLabel: string;
  audioOutLabel: string;
  mainDurationSec: number;
  layout: LayoutPreset;
  outW: number;
  outH: number;
  zoomW: number;
  zoomH: number;
  resolutionScale: number;
  speed: number;
  segmentContexts: Array<{
    presetApplications?: PresetApplicationPayload[];
    effects: LoadedExportEffect[];
  }>;
  resolvedHook: ResolvedHook | null;
  closingSettings: CompositionClosingSettings | null;
  sourcePath: string;
  vodId: string;
};

export type BookendsGraphResult = {
  filterParts: string[];
  ffmpegArgs: string[];
  videoOutLabel: string;
  audioOutLabel: string;
  totalDurationSec: number;
};

function buildHookPart(ctx: BookendsGraphContext): {
  videoLabel: string;
  audioLabel: string;
  durationSec: number;
  parts: string[];
  nextInputIndex: number;
} | null {
  const hook = ctx.resolvedHook;
  if (!hook || hook.durationSec < 0.01) return null;

  const parts: string[] = [];
  let vLabels: string[] = [];
  let aLabels: string[] = [];
  let inputIdx = ctx.nextInputIndex;

  for (let hi = 0; hi < hook.slices.length; hi++) {
    const slice = hook.slices[hi];
    const segCtx = ctx.segmentContexts[slice.segmentIndex];
    if (!segCtx) continue;

    const ss = slice.vodStart;
    const dur = slice.duration;
    ctx.ffmpegArgs.push(
      "-ss",
      String(Number(ss.toFixed(6))),
      "-t",
      String(Number(dur.toFixed(6))),
      "-i",
      ctx.sourcePath
    );
    const segInputIndex = inputIdx++;
    const effectIndexes: number[] = [];
    for (const effect of segCtx.effects) {
      if (effect.instance.type === "image") {
        ctx.ffmpegArgs.push("-loop", "1");
      }
      ctx.ffmpegArgs.push("-i", effect.absoluteFilePath);
      effectIndexes.push(inputIdx++);
    }

    const vLabel = `hk${hi}v`;
    const aLabel = `hk${hi}a`;
    parts.push(
      ...buildSegmentFilterGraph({
        tag: `hk${hi}`,
        inputIndex: segInputIndex,
        clipDuration: dur,
        layout: ctx.layout,
        outW: ctx.outW,
        outH: ctx.outH,
        zoomW: ctx.zoomW,
        zoomH: ctx.zoomH,
        resolutionScale: ctx.resolutionScale,
        speed: ctx.speed,
        presetApplications: segCtx.presetApplications,
        effects: segCtx.effects,
        effectInputIndexes: effectIndexes,
        videoOutLabel: vLabel,
        audioOutLabel: aLabel,
      })
    );
    vLabels.push(vLabel);
    aLabels.push(aLabel);
  }

  if (!vLabels.length) return null;

  let vOut = vLabels[0];
  let aOut = aLabels[0];
  if (vLabels.length > 1) {
    for (let j = 1; j < vLabels.length; j++) {
      const vCat = `hkvcat${j}`;
      const aCat = `hkacat${j}`;
      parts.push(
        `[${vOut}][${vLabels[j]}]concat=n=2:v=1:a=0[${vCat}]`,
        `[${aOut}][${aLabels[j]}]concat=n=2:v=0:a=1[${aCat}]`
      );
      vOut = vCat;
      aOut = aCat;
    }
  }

  return {
    videoLabel: vOut,
    audioLabel: aOut,
    durationSec: hook.durationSec,
    parts,
    nextInputIndex: inputIdx,
  };
}

function libraryAbsolutePath(item: EffectLibraryItem): string {
  return resolveEffectFilePath(item);
}

function buildClosingPart(
  ctx: BookendsGraphContext,
  startInputIndex: number
): {
  videoLabel: string;
  audioLabel: string;
  durationSec: number;
  parts: string[];
  nextInputIndex: number;
} | null {
  const closing = ctx.closingSettings;
  if (!closing?.enabled || !closing.libraryItemId) return null;

  const item = getEffectLibraryItemById(closing.libraryItemId);
  if (item.type !== "video" && item.type !== "image") return null;

  const dur = Math.max(0.1, closing.durationSec ?? 1.5);
  const fade = closing.fadeIn !== false ? DEFAULT_FADE_IN_SEC : 0;
  const absPath = libraryAbsolutePath(item);
  let inputIdx = startInputIndex;

  if (item.type === "image") {
    ctx.ffmpegArgs.push("-loop", "1", "-t", String(dur), "-i", absPath);
  } else {
    ctx.ffmpegArgs.push("-t", String(dur), "-i", absPath);
  }
  const inIdx = inputIdx++;

  const parts: string[] = [];
  const v0 = "close_v0";
  const a0 = "close_a0";
  let vChain = `[${inIdx}:v]scale=${ctx.outW}:${ctx.outH}:force_original_aspect_ratio=decrease,pad=${ctx.outW}:${ctx.outH}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  if (fade > 0.01) {
    vChain += `,fade=t=in:st=0:d=${fmt(fade)}:alpha=1`;
  }
  parts.push(`${vChain}[${v0}]`);
  if (item.type === "video") {
    parts.push(
      `[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${fmt(dur)},asetpts=PTS-STARTPTS[${a0}]`
    );
  } else {
    parts.push(
      `anullsrc=r=48000:cl=stereo:d=${fmt(dur)},asetpts=PTS-STARTPTS[${a0}]`
    );
  }

  return {
    videoLabel: v0,
    audioLabel: a0,
    durationSec: dur,
    parts,
    nextInputIndex: inputIdx,
  };
}

/** Prepend hook (hard AV concat) and append closing in the same filter_complex. */
export function appendBookendsToGraph(
  ctx: BookendsGraphContext
): BookendsGraphResult {
  const filterParts = [...ctx.filterParts];
  let videoOut = ctx.videoOutLabel;
  let audioOut = ctx.audioOutLabel;
  let totalDur = ctx.mainDurationSec;
  let nextIdx = ctx.nextInputIndex;

  const hook = buildHookPart({ ...ctx, nextInputIndex: nextIdx });
  if (hook) {
    filterParts.push(...hook.parts);
    const vCat = "vhooked";
    const aCat = "ahooked";
    filterParts.push(
      `[${hook.videoLabel}][${videoOut}]concat=n=2:v=1:a=0[${vCat}]`,
      `[${hook.audioLabel}][${audioOut}]concat=n=2:v=0:a=1[${aCat}]`
    );
    videoOut = vCat;
    audioOut = aCat;
    totalDur += hook.durationSec;
    nextIdx = hook.nextInputIndex;
  }

  const closing = buildClosingPart(
    { ...ctx, nextInputIndex: nextIdx },
    nextIdx
  );
  if (closing) {
    filterParts.push(...closing.parts);
    const vCat = "vclosed";
    const aCat = "aclosed";
    filterParts.push(
      `[${videoOut}][${closing.videoLabel}]concat=n=2:v=1:a=0[${vCat}]`,
      `[${audioOut}][${closing.audioLabel}]concat=n=2:v=0:a=1[${aCat}]`
    );
    videoOut = vCat;
    audioOut = aCat;
    totalDur += closing.durationSec;
    nextIdx = closing.nextInputIndex;
  }

  return {
    filterParts,
    ffmpegArgs: ctx.ffmpegArgs,
    videoOutLabel: videoOut,
    audioOutLabel: audioOut,
    totalDurationSec: Number(totalDur.toFixed(3)),
  };
}
