/**
 * Single-pass ffmpeg filter graph for camada 3 unified render (contract §20.2).
 * Does not modify exportCandidate / exportComposition.
 */

import type { LayoutPreset } from "../pipeline/layoutPresets";
import { buildFilterComplex } from "../pipeline/clipRenderer";
import {
  buildAudioFxMixOntoLabel,
  buildMainAudioPrepare,
  buildVideoOverlayFilters,
  hasAudioEffects,
  hasVideoEffects,
  type LoadedExportEffect,
} from "./effectsExportFilters";
import {
  buildAtempoChain,
  buildPitchPreservingTempo,
  buildSpeedRampSetptsExpr,
  buildWastedCameraFilterExpr,
  buildZoomFilterExpr,
  colorPresetFilterExpr,
  normalizeColorEffectTiming,
  normalizeSpeedRamp,
  normalizeZoomKeyframes,
  type PresetApplicationPayload,
  type SpeedRampPoint,
  type ZoomKeyframe,
} from "./candidateExportService";
import { evenDim } from "./qualityPresets";
import {
  type CompositionJoinSettings,
  type ResolvedJoin,
  type SegmentSourceBounds,
  resolveJoinSettings,
  segmentAudioPads,
} from "./compositionJoinSettings";
import { buildTimelineJoinGraph } from "./compositionTimelineJoin";
import {
  appendBookendsToGraph,
} from "./compositionBookendsGraph";
import {
  isHookActive,
  normalizeHookRange,
  parseCompositionOpeningSettings,
} from "./compositionOpeningSettings";
import {
  isClosingActive,
  parseCompositionClosingSettings,
} from "./compositionClosingSettings";
import { resolveHookFromTimeline } from "./compositionHookResolve";
import type { CompositionColorSettings } from "./compositionColorSettings";
import type { CompositionOpeningSettings } from "./compositionOpeningSettings";
import type { CompositionClosingSettings } from "./compositionClosingSettings";

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function sortPresetApplications(
  apps: PresetApplicationPayload[]
): PresetApplicationPayload[] {
  return [...apps].sort((a, b) => a.effectStart - b.effectStart);
}

export function mergeSegmentPresetApplications(
  apps: PresetApplicationPayload[]
): {
  zoomKeyframes: ZoomKeyframe[] | null;
  speedRamp: SpeedRampPoint[] | null;
  colorFilters: string[];
  wastedApp: PresetApplicationPayload | null;
} {
  const sorted = sortPresetApplications(apps);
  const wasted = sorted.find((a) => a.presetId === "wasted") ?? null;
  const inPlace = wasted ? sorted.filter((a) => a.presetId !== "wasted") : sorted;

  const allZoom: ZoomKeyframe[] = [];
  const allSpeed: SpeedRampPoint[] = [];
  const colorFilters: string[] = [];

  for (const app of inPlace) {
    const zk = normalizeZoomKeyframes(app.zoomKeyframes);
    if (zk) {
      allZoom.push(...zk);
      const endT = Number(app.effectEnd.toFixed(3));
      const last = zk[zk.length - 1];
      const resetAt =
        last && last.time < endT - 0.001
          ? endT
          : Number((endT + 0.001).toFixed(3));
      if (!last || last.scale !== 1 || last.x !== 50 || last.y !== 50) {
        allZoom.push({ time: resetAt, scale: 1, x: 50, y: 50 });
      }
    }
    const sr = normalizeSpeedRamp(app.speedRamp);
    if (sr) allSpeed.push(...sr);
    const cp =
      app.colorPreset == null || app.colorPreset === "none"
        ? "none"
        : app.colorPreset;
    if (cp !== "none") {
      const timing = normalizeColorEffectTiming(
        app.colorEffectStart ?? app.effectStart,
        app.colorEffectEnd ?? app.effectEnd,
        app.colorFadeSeconds
      );
      const f = colorPresetFilterExpr(
        cp,
        app.intensityPercent ?? 100,
        timing
      );
      if (f) colorFilters.push(f);
    }
  }

  return {
    zoomKeyframes: normalizeZoomKeyframes(allZoom),
    speedRamp: normalizeSpeedRamp(allSpeed),
    colorFilters,
    wastedApp: wasted,
  };
}

function relabelInputRefs(filter: string, inputIndex: number): string {
  return filter.replace(/\[0:(v|a)\]/g, `[${inputIndex}:$1]`);
}

function speedRampIntervals(
  ramp: SpeedRampPoint[],
  clipDuration: number
): Array<{ start: number; end: number; speed: number }> {
  const pts = [...ramp].sort((a, b) => a.time - b.time);
  const intervals: Array<{ start: number; end: number; speed: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].time;
    const end =
      i + 1 < pts.length
        ? pts[i + 1].time
        : Math.max(clipDuration, start + 0.001);
    if (end > start) {
      intervals.push({ start, end, speed: pts[i].speed });
    }
  }
  return intervals;
}

function buildRampAudioFilter(
  ramp: SpeedRampPoint[],
  clipDuration: number
): string {
  const intervals = speedRampIntervals(ramp, clipDuration);
  if (intervals.length === 0) return "";
  if (intervals.length === 1 && Math.abs(intervals[0].speed - 1) < 1e-6) {
    return "";
  }
  const n = intervals.length;
  const splitLabel = intervals.map((_, i) => `[as${i}]`).join("");
  const parts: string[] = [`[0:a]asplit=${n}${splitLabel}`];
  const concatIn: string[] = [];
  for (let i = 0; i < n; i++) {
    const { start, end, speed } = intervals[i];
    const s = Number(start.toFixed(6));
    const e = Number(end.toFixed(6));
    const atempo = buildAtempoChain(speed);
    const trimmed = `[as${i}]atrim=${s}:${e},asetpts=PTS-STARTPTS`;
    if (atempo) {
      parts.push(`${trimmed},${atempo}[ae${i}]`);
    } else {
      parts.push(`${trimmed}[ae${i}]`);
    }
    concatIn.push(`[ae${i}]`);
  }
  parts.push(`${concatIn.join("")}concat=n=${n}:v=0:a=1[aout]`);
  return parts.join(";");
}

function rampAudioForInput(
  inputIndex: number,
  ramp: SpeedRampPoint[],
  clipDuration: number
): string {
  return relabelInputRefs(buildRampAudioFilter(ramp, clipDuration), inputIndex);
}

function mainAudioPrepareForLabel(
  audioLabel: string,
  effects: LoadedExportEffect[],
  tempoFilter: string | null
): string | null {
  const raw = buildMainAudioPrepare(effects, tempoFilter);
  if (!raw) return null;
  return raw.replace(/\[0:a\]/g, `[${audioLabel}]`);
}

function rampAudioForLabel(
  audioLabel: string,
  ramp: SpeedRampPoint[],
  clipDuration: number
): string {
  return buildRampAudioFilter(ramp, clipDuration).replace(
    /\[0:a\]/g,
    `[${audioLabel}]`
  );
}

export type SegmentGraphContext = {
  /** Unique label prefix for this trecho inside the shared filter graph. */
  tag: string;
  inputIndex: number;
  clipDuration: number;
  layout: LayoutPreset;
  outW: number;
  outH: number;
  zoomW: number;
  zoomH: number;
  resolutionScale: number;
  speed: number;
  presetApplications?: PresetApplicationPayload[];
  effects: LoadedExportEffect[];
  effectInputIndexes: number[];
  videoOutLabel: string;
  audioOutLabel: string;
  audioPadBefore?: number;
  audioPadAfter?: number;
};

function splitLayoutFromVideoLabel(
  layout: LayoutPreset,
  videoLabel: string,
  tag: string,
  postLayout: string,
  vOutLabel: string
): string {
  const g = layout.gameplayCrop!;
  const w = layout.webcamCrop!;
  const outW = layout.outputResolution.w;
  const outH = layout.outputResolution.h;
  const ratios = layout.splitPanelRatios!;
  const camH = Math.round((outH * ratios.webcam) / 2) * 2;
  const gameH = outH - camH;
  const camTag = `cam_${tag}`;
  const gameTag = `game_${tag}`;
  const voutTag = `vout_${tag}`;
  const sp1 = `${tag}_sp1`;
  const sp2 = `${tag}_sp2`;
  const parts = [
    `[${videoLabel}]split=2[${sp1}][${sp2}]`,
    `[${sp1}]crop=${w.w}:${w.h}:${w.x}:${w.y},scale=${outW}:${camH}:force_original_aspect_ratio=increase,crop=${outW}:${camH}[${camTag}]`,
    `[${sp2}]crop=${g.w}:${g.h}:${g.x}:${g.y},scale=${outW}:${gameH}:force_original_aspect_ratio=increase,crop=${outW}:${gameH}[${gameTag}]`,
    `[${camTag}][${gameTag}]vstack=inputs=2[${voutTag}]`,
  ];
  if (postLayout) {
    parts.push(`[${voutTag}]${postLayout}[${vOutLabel}]`);
  } else {
    parts.push(`[${voutTag}]null[${vOutLabel}]`);
  }
  return parts.join(";");
}

function layoutChainForInput(
  layout: LayoutPreset,
  inputIndex: number,
  tag: string,
  postLayout: string,
  vOutLabel: string,
  trimmedVideoLabel?: string
): string {
  const videoLabel = trimmedVideoLabel ?? `${inputIndex}:v`;
  if (layout.split) {
    return splitLayoutFromVideoLabel(
      layout,
      videoLabel,
      tag,
      postLayout,
      vOutLabel
    );
  }
  const layoutFilter = buildFilterComplex(layout);
  if (!layoutFilter) {
    throw new Error(`Could not build layout filter for preset ${layout.id}`);
  }
  const vf = postLayout
    ? `${layoutFilter},${postLayout}`
    : layoutFilter;
  return `[${videoLabel}]${vf}[${vOutLabel}]`;
}

function postLayoutParts(opts: {
  zoomKeyframes: ZoomKeyframe[] | null;
  speedRamp: SpeedRampPoint[] | null;
  speed: number;
  colorFilters: string[];
  zoomW: number;
  zoomH: number;
  resolutionScale: number;
  outW: number;
  outH: number;
}): string {
  const parts: string[] = [];
  if (opts.zoomKeyframes) {
    parts.push(buildZoomFilterExpr(opts.zoomKeyframes, opts.zoomW, opts.zoomH));
  }
  parts.push(...opts.colorFilters);
  const rampActive = opts.speedRamp != null;
  const speedChanged = !rampActive && Math.abs(opts.speed - 1) > 1e-6;
  if (rampActive && opts.speedRamp) {
    parts.push(buildSpeedRampSetptsExpr(opts.speedRamp));
  } else if (speedChanged) {
    parts.push(`setpts=PTS/${Number(opts.speed.toFixed(6))}`);
  }
  if (opts.resolutionScale !== 1) {
    parts.push(`scale=${opts.outW}:${opts.outH}`);
  }
  parts.push("setsar=1");
  return parts.join(",");
}

function buildPlainSegmentGraph(ctx: SegmentGraphContext): string[] {
  const merged = mergeSegmentPresetApplications(ctx.presetApplications ?? []);
  const speedRamp = merged.speedRamp;
  const speed = speedRamp ? 1 : ctx.speed;
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const postCore = postLayoutParts({
    zoomKeyframes: merged.zoomKeyframes,
    speedRamp,
    speed,
    colorFilters: merged.colorFilters,
    zoomW: ctx.zoomW,
    zoomH: ctx.zoomH,
    resolutionScale: ctx.resolutionScale,
    outW: ctx.outW,
    outH: ctx.outH,
  });

  const parts: string[] = [];
  const vCore = `${ctx.videoOutLabel}_core`;
  const padBefore = ctx.audioPadBefore ?? 0;
  const padAfter = ctx.audioPadAfter ?? 0;
  const videoLabel =
    padBefore > 0
      ? `${ctx.tag}_vtrim`
      : `${ctx.inputIndex}:v`;

  if (padBefore > 0) {
    parts.push(
      `[${ctx.inputIndex}:v]trim=${fmt(padBefore)}:${fmt(padBefore + ctx.clipDuration)},setpts=PTS-STARTPTS[${videoLabel}]`
    );
  }

  parts.push(
    layoutChainForInput(
      ctx.layout,
      ctx.inputIndex,
      ctx.tag,
      postCore,
      vCore,
      padBefore > 0 ? videoLabel : undefined
    )
  );

  let vCurrent = vCore;
  if (hasVideoEffects(ctx.effects)) {
    const vOvl = `${ctx.videoOutLabel}_ovl`;
    parts.push(
      buildVideoOverlayFilters(
        ctx.effects,
        ctx.effectInputIndexes,
        ctx.outW,
        ctx.outH,
        vCore,
        vOvl,
        `${ctx.tag}_`,
        ctx.clipDuration
      )
    );
    vCurrent = vOvl;
  }
  parts.push(
    `[${vCurrent}]scale=${ctx.outW}:${ctx.outH},setsar=1[${ctx.videoOutLabel}]`
  );

  const audioDur = ctx.clipDuration + padBefore + padAfter;
  const audioTrim =
    padBefore > 0 || padAfter > 0
      ? `[${ctx.inputIndex}:a]atrim=0:${fmt(audioDur)},asetpts=PTS-STARTPTS[${ctx.audioOutLabel}_asrc]`
      : null;
  if (audioTrim) {
    parts.push(audioTrim);
  }
  const audioInputLabel =
    padBefore > 0 || padAfter > 0
      ? `${ctx.audioOutLabel}_asrc`
      : `${ctx.inputIndex}:a`;

  const rampAudio =
    rampActive && speedRamp
      ? rampAudioForLabel(audioInputLabel, speedRamp, audioDur)
      : "";

  const audioParts: string[] = [];
  if (rampAudio) {
    audioParts.push(rampAudio.replace(/\[aout\]/g, `[${ctx.audioOutLabel}_r]`));
    const mix = buildAudioFxMixOntoLabel(
      ctx.effects,
      ctx.effectInputIndexes,
      `${ctx.audioOutLabel}_r`,
      `${ctx.tag}_`
    );
    if (mix) audioParts.push(mix.replace("[aout]", `[${ctx.audioOutLabel}]`));
    else audioParts.push(`[${ctx.audioOutLabel}_r]anull[${ctx.audioOutLabel}]`);
  } else if (speedChanged) {
    const atempo = buildAtempoChain(speed);
    const prepare = mainAudioPrepareForLabel(
      audioInputLabel,
      ctx.effects,
      atempo
    );
    if (hasAudioEffects(ctx.effects)) {
      if (prepare) audioParts.push(prepare.replace("[amain]", `[${ctx.audioOutLabel}_m]`));
      const mix = buildAudioFxMixOntoLabel(
        ctx.effects,
        ctx.effectInputIndexes,
        `${ctx.audioOutLabel}_m`,
        `${ctx.tag}_`
      );
      if (mix) audioParts.push(mix.replace("[aout]", `[${ctx.audioOutLabel}]`));
    } else if (prepare) {
      audioParts.push(prepare.replace("[amain]", `[${ctx.audioOutLabel}]`));
    } else {
      audioParts.push(
        `[${audioInputLabel}]${atempo}[${ctx.audioOutLabel}]`
      );
    }
  } else {
    const prepare = mainAudioPrepareForLabel(audioInputLabel, ctx.effects, null);
    if (hasAudioEffects(ctx.effects)) {
      if (prepare) audioParts.push(prepare.replace("[amain]", `[${ctx.audioOutLabel}_m]`));
      const mix = buildAudioFxMixOntoLabel(
        ctx.effects,
        ctx.effectInputIndexes,
        `${ctx.audioOutLabel}_m`,
        `${ctx.tag}_`
      );
      if (mix) audioParts.push(mix.replace("[aout]", `[${ctx.audioOutLabel}]`));
    } else if (prepare) {
      audioParts.push(prepare.replace("[amain]", `[${ctx.audioOutLabel}]`));
    } else {
      parts.push(`[${audioInputLabel}]anull[${ctx.audioOutLabel}]`);
    }
  }

  if (audioParts.length > 0) {
    parts.push(...audioParts);
  } else if (!parts.some((p) => p.includes(`[${ctx.audioOutLabel}]`))) {
    parts.push(`[${ctx.inputIndex}:a]anull[${ctx.audioOutLabel}]`);
  }

  return parts;
}

function buildWastedSegmentGraph(ctx: SegmentGraphContext): string[] {
  const merged = mergeSegmentPresetApplications(ctx.presetApplications ?? []);
  const wasted = merged.wastedApp;
  if (!wasted) {
    return buildPlainSegmentGraph(ctx);
  }

  const clipDuration = ctx.clipDuration;
  const insertAt = clampNum(wasted.effectStart, 0, clipDuration);
  const effectDuration =
    wasted.effectDuration ??
    Math.max(0.5, wasted.effectEnd - wasted.effectStart);
  const intensityPercent = wasted.intensityPercent ?? 100;
  const f = intensityPercent / 100;
  const endSpeed = clampNum(1 - 0.55 * f, 0.25, 1.0);
  let sourceSeconds = effectDuration * endSpeed;
  const maxSrc = Math.max(0.05, clipDuration - insertAt);
  if (sourceSeconds > maxSrc) sourceSeconds = maxSrc;
  sourceSeconds = Number(Math.max(0.05, sourceSeconds).toFixed(3));

  const speed = sourceSeconds / effectDuration;
  const setpts = `setpts=PTS/${Number(speed.toFixed(6))}`;
  const audioTempo = buildPitchPreservingTempo(speed);
  const camera = buildWastedCameraFilterExpr(
    effectDuration,
    intensityPercent,
    ctx.zoomW,
    ctx.zoomH
  );
  const color = colorPresetFilterExpr("wasted_grayscale", intensityPercent, {
    start: 0,
    end: effectDuration,
    fadeSeconds: 0.25,
  });

  const parts: string[] = [];
  const idx = ctx.inputIndex;
  const tag = ctx.tag;

  function normalizeBranch(): string {
    return `scale=${ctx.outW}:${ctx.outH},setsar=1`;
  }

  function layoutPart(
    trimExpr: string,
    partTag: string,
    postLayout: string,
    vOut: string
  ): void {
    const vTrim = `${partTag}_vt`;
    parts.push(`[${idx}:v]${trimExpr},setpts=PTS-STARTPTS[${vTrim}]`);
    if (ctx.layout.split) {
      parts.push(
        splitLayoutFromVideoLabel(
          ctx.layout,
          vTrim,
          partTag,
          postLayout,
          vOut
        )
      );
    } else {
      const layoutFilter = buildFilterComplex(ctx.layout);
      if (!layoutFilter) {
        throw new Error(`Could not build layout filter for preset ${ctx.layout.id}`);
      }
      const vf = postLayout ? `${layoutFilter},${postLayout}` : layoutFilter;
      parts.push(`[${vTrim}]${vf}[${vOut}]`);
    }
  }

  const beforeDur = insertAt;
  const afterStart = insertAt + effectDuration;
  const afterDur = clipDuration - afterStart;
  const concatV: string[] = [];
  const concatA: string[] = [];

  if (beforeDur > 0.05) {
    const vB = `${ctx.videoOutLabel}_b`;
    const aB = `${ctx.audioOutLabel}_b`;
    layoutPart(`trim=0:${fmt(beforeDur)}`, `${tag}_before`, normalizeBranch(), vB);
    parts.push(
      `[${idx}:a]atrim=0:${fmt(beforeDur)},asetpts=PTS-STARTPTS[${aB}]`
    );
    concatV.push(`[${vB}]`);
    concatA.push(`[${aB}]`);
  }

  {
    const vW = `${ctx.videoOutLabel}_w`;
    const aW = `${ctx.audioOutLabel}_w`;
    const wastedPost = [setpts, camera];
    if (color) wastedPost.push(color);
    wastedPost.push(normalizeBranch());
    layoutPart(
      `trim=${fmt(insertAt)}:${fmt(insertAt + sourceSeconds)}`,
      `${tag}_wasted`,
      wastedPost.join(","),
      vW
    );
    const aChain = audioTempo
      ? `[${idx}:a]atrim=${fmt(insertAt)}:${fmt(insertAt + sourceSeconds)},asetpts=PTS-STARTPTS,${audioTempo}[${aW}]`
      : `[${idx}:a]atrim=${fmt(insertAt)}:${fmt(insertAt + sourceSeconds)},asetpts=PTS-STARTPTS[${aW}]`;
    parts.push(aChain);
    concatV.push(`[${vW}]`);
    concatA.push(`[${aW}]`);
  }

  if (afterDur > 0.05) {
    const vA = `${ctx.videoOutLabel}_a`;
    const aA = `${ctx.audioOutLabel}_a`;
    layoutPart(
      `trim=${fmt(afterStart)}:${fmt(clipDuration)}`,
      `${tag}_after`,
      normalizeBranch(),
      vA
    );
    parts.push(
      `[${idx}:a]atrim=${fmt(afterStart)}:${fmt(clipDuration)},asetpts=PTS-STARTPTS[${aA}]`
    );
    concatV.push(`[${vA}]`);
    concatA.push(`[${aA}]`);
  }

  const vCat = `${ctx.videoOutLabel}_cat`;
  const aRaw = `${ctx.audioOutLabel}_raw`;

  const n = concatV.length;
  const concatIn = concatV.flatMap((v, i) => [v, concatA[i]]).join("");
  parts.push(
    `${concatIn}concat=n=${n}:v=1:a=1[${vCat}][${aRaw}]`
  );

  let vCurrent = vCat;
  if (hasVideoEffects(ctx.effects)) {
    const vOvl = `${ctx.videoOutLabel}_ovl`;
    parts.push(
      buildVideoOverlayFilters(
        ctx.effects,
        ctx.effectInputIndexes,
        ctx.outW,
        ctx.outH,
        vCat,
        vOvl,
        `${ctx.tag}_`,
        ctx.clipDuration
      )
    );
    vCurrent = vOvl;
  }
  parts.push(
    `[${vCurrent}]scale=${ctx.outW}:${ctx.outH},setsar=1[${ctx.videoOutLabel}]`
  );

  if (hasAudioEffects(ctx.effects)) {
    const mix = buildAudioFxMixOntoLabel(
      ctx.effects,
      ctx.effectInputIndexes,
      aRaw.replace(/^\[|\]$/g, ""),
      `${ctx.tag}_`
    );
    if (mix) {
      parts.push(mix.replace("[aout]", `[${ctx.audioOutLabel}]`));
    } else {
      parts.push(`[${aRaw}]anull[${ctx.audioOutLabel}]`);
    }
  } else {
    parts.push(`[${aRaw}]anull[${ctx.audioOutLabel}]`);
  }

  return parts;
}

export function buildSegmentFilterGraph(ctx: SegmentGraphContext): string[] {
  const hasWasted = (ctx.presetApplications ?? []).some(
    (a) => a.presetId === "wasted"
  );
  if (hasWasted) {
    return buildWastedSegmentGraph(ctx);
  }
  return buildPlainSegmentGraph(ctx);
}

export type UnifiedGraphInput = {
  sourcePath: string;
  segments: Array<{
    vodStart: number;
    duration: number;
    sourceBounds: SegmentSourceBounds;
    layout: LayoutPreset;
    outW: number;
    outH: number;
    zoomW: number;
    zoomH: number;
    resolutionScale: number;
    speed: number;
    presetApplications?: PresetApplicationPayload[];
    effects: LoadedExportEffect[];
  }>;
  joinSettings?: CompositionJoinSettings;
  colorSettings?: CompositionColorSettings;
  openingSettings?: CompositionOpeningSettings;
  closingSettings?: CompositionClosingSettings;
  vodId?: string;
  /** Pre-built subtitles filter chain segment e.g. subtitles='...' */
  subtitlesFilter?: string | null;
};

export type UnifiedGraphResult = {
  ffmpegArgs: string[];
  filterComplex: string;
  videoOutLabel: string;
  audioOutLabel: string;
  totalDurationSec: number;
  joinWarnings: string[];
};

/** Build ffmpeg inputs + filter_complex for a single-pass unified composition render. */
export function buildUnifiedCompositionGraph(
  input: UnifiedGraphInput
): UnifiedGraphResult {
  const args: string[] = [];
  const filterParts: string[] = [];
  let nextInputIndex = 0;
  const segmentOuts: Array<{ v: string; a: string }> = [];
  const segmentDurations: number[] = [];
  const sourceBoundsList = input.segments.map((s) => s.sourceBounds);

  const resolvedJoins = resolveJoinSettings(
    input.joinSettings ?? {},
    sourceBoundsList,
    input.segments.map((s) => s.duration)
  );

  for (let si = 0; si < input.segments.length; si++) {
    const seg = input.segments[si];
    const pads = segmentAudioPads(si, resolvedJoins);
    const padBefore = pads.padBefore;
    const padAfter = pads.padAfter;
    const ss = Math.max(0, seg.vodStart - padBefore);
    const inputDur = seg.duration + padBefore + padAfter;

    const segInputIndex = nextInputIndex;
    args.push(
      "-ss",
      String(Number(ss.toFixed(6))),
      "-t",
      String(Number(inputDur.toFixed(6))),
      "-i",
      input.sourcePath
    );
    nextInputIndex++;

    const effectIndexes: number[] = [];
    for (const effect of seg.effects) {
      if (effect.instance.type === "image") {
        args.push("-loop", "1");
      }
      args.push("-i", effect.absoluteFilePath);
      effectIndexes.push(nextInputIndex);
      nextInputIndex++;
    }

    const vLabel = `sv${si}`;
    const aLabel = `sa${si}`;
    filterParts.push(
      ...buildSegmentFilterGraph({
        tag: `s${si}`,
        inputIndex: segInputIndex,
        clipDuration: seg.duration,
        layout: seg.layout,
        outW: seg.outW,
        outH: seg.outH,
        zoomW: seg.zoomW,
        zoomH: seg.zoomH,
        resolutionScale: seg.resolutionScale,
        speed: seg.speed,
        presetApplications: seg.presetApplications,
        effects: seg.effects,
        effectInputIndexes: effectIndexes,
        videoOutLabel: vLabel,
        audioOutLabel: aLabel,
        audioPadBefore: padBefore,
        audioPadAfter: padAfter,
      })
    );
    segmentOuts.push({ v: vLabel, a: aLabel });
    segmentDurations.push(seg.duration);
  }

  const joinGraph = buildTimelineJoinGraph({
    segmentVideoLabels: segmentOuts.map((o) => o.v),
    segmentAudioLabels: segmentOuts.map((o) => o.a),
    segmentDurations,
    resolvedJoins,
  });
  filterParts.push(...joinGraph.filterParts);

  let videoOut = joinGraph.videoOutLabel;
  let audioOut = joinGraph.audioOutLabel;

  const color = input.colorSettings;
  if (color?.enabled && color.preset && color.preset !== "none") {
    const cf = colorPresetFilterExpr(
      color.preset,
      color.intensityPercent ?? 100
    );
    if (cf) {
      filterParts.push(`[${videoOut}]${cf}[vcolor]`);
      videoOut = "vcolor";
    }
  }

  if (input.subtitlesFilter) {
    filterParts.push(`[${videoOut}]${input.subtitlesFilter}[vfinal]`);
    videoOut = "vfinal";
  }

  const openingRaw = parseCompositionOpeningSettings(input.openingSettings);
  const closingRaw = parseCompositionClosingSettings(input.closingSettings);
  const contentDur = joinGraph.totalDurationSec;
  const { settings: openingNorm, warnings: hookWarnings } = normalizeHookRange(
    openingRaw,
    contentDur
  );
  const bookendWarnings = [...joinGraph.warnings, ...hookWarnings];

  let resolvedHook = null;
  if (
    isHookActive(openingNorm) &&
    typeof openingNorm.hookStartSec === "number" &&
    typeof openingNorm.hookEndSec === "number"
  ) {
    let timeline = 0;
    const timelineSegs = input.segments.map((s) => {
      const row = {
        vodStart: s.vodStart,
        duration: s.duration,
        timelineStart: timeline,
      };
      timeline += s.duration;
      return row;
    });
    resolvedHook = resolveHookFromTimeline(
      timelineSegs,
      openingNorm.hookStartSec,
      openingNorm.hookEndSec
    );
  }

  const closingActive = isClosingActive(closingRaw);
  let totalDurationSec = contentDur;
  let finalVideoOut = videoOut;
  let finalAudioOut = audioOut;

  if ((resolvedHook && isHookActive(openingNorm)) || closingActive) {
    const bookended = appendBookendsToGraph({
      filterParts,
      ffmpegArgs: args,
      nextInputIndex,
      videoOutLabel: videoOut,
      audioOutLabel: audioOut,
      mainDurationSec: contentDur,
      layout: input.segments[0]!.layout,
      outW: input.segments[0]!.outW,
      outH: input.segments[0]!.outH,
      zoomW: input.segments[0]!.zoomW,
      zoomH: input.segments[0]!.zoomH,
      resolutionScale: input.segments[0]!.resolutionScale,
      speed: input.segments[0]!.speed,
      segmentContexts: input.segments.map((s) => ({
        presetApplications: s.presetApplications,
        effects: s.effects,
      })),
      resolvedHook: isHookActive(openingNorm) ? resolvedHook : null,
      closingSettings: closingActive ? closingRaw : null,
      sourcePath: input.sourcePath,
      vodId: input.vodId ?? "",
    });
    return {
      ffmpegArgs: bookended.ffmpegArgs,
      filterComplex: bookended.filterParts.join(";"),
      videoOutLabel: bookended.videoOutLabel,
      audioOutLabel: bookended.audioOutLabel,
      totalDurationSec: bookended.totalDurationSec,
      joinWarnings: bookendWarnings,
    };
  }

  return {
    ffmpegArgs: args,
    filterComplex: filterParts.join(";"),
    videoOutLabel: finalVideoOut,
    audioOutLabel: finalAudioOut,
    totalDurationSec,
    joinWarnings: bookendWarnings,
  };
}

export function resolveCompositionDimensions(
  layout: LayoutPreset,
  resolutionScale: number
): { outW: number; outH: number; zoomW: number; zoomH: number } {
  const nativeW = layout.outputResolution.w;
  const nativeH = layout.outputResolution.h;
  return {
    outW: evenDim(nativeW * resolutionScale),
    outH: evenDim(nativeH * resolutionScale),
    zoomW: nativeW,
    zoomH: nativeH,
  };
}
