/**
 * FFmpeg filter helpers for applied library effects (video/image overlays,
 * music, sfx). Used by candidateExportService — additive only when effects exist.
 *
 * Video order (confirmed): … → scale → overlays → subtitles
 *
 * overlay_cuda is NOT used — CPU overlay supports `enable=` timeline windows.
 */

import type {
  ClipEffectInstance,
  EffectLibraryItem,
} from "./effectsLibraryService";
import { normalizeVisualFades } from "../lib/overlayFade.js";
import {
  buildBackgroundKeyFilterExpr,
  parseBackgroundRemovalMode,
  type BackgroundRemovalMode,
} from "./backgroundRemoval.js";

export type LoadedExportEffect = {
  instance: ClipEffectInstance;
  libraryItem: EffectLibraryItem;
  absoluteFilePath: string;
};

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function hexToFfmpegColor(hex: string | null | undefined): string {
  const raw = (hex ?? "#00FF00").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return "0x00FF00";
  return `0x${raw}`;
}

function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/** Append -i for each effect file. Images need `-loop 1` before input. */
export function appendEffectInputs(
  args: string[],
  effects: LoadedExportEffect[]
): number[] {
  const inputIndexes: number[] = [];
  for (let i = 0; i < effects.length; i++) {
    if (effects[i].instance.type === "image") {
      args.push("-loop", "1");
    }
    args.push("-i", effects[i].absoluteFilePath);
    inputIndexes.push(i + 1);
  }
  return inputIndexes;
}

export function hasVideoEffects(effects: LoadedExportEffect[]): boolean {
  return effects.some(
    (e) => e.instance.type === "video" || e.instance.type === "image"
  );
}

export function hasAudioEffects(effects: LoadedExportEffect[]): boolean {
  return effects.some(
    (e) => e.instance.type === "music" || e.instance.type === "sfx"
  );
}

function partDurationSeconds(inst: ClipEffectInstance): number {
  const trimStart = inst.sourceTrimStart ?? 0;
  const trimEnd = inst.sourceTrimEnd;
  if (typeof trimEnd === "number" && trimEnd > trimStart) {
    return trimEnd - trimStart;
  }
  return 1;
}

function overlayDisplayDuration(
  inst: ClipEffectInstance,
  loopUnitSec: number,
  clipDurationSec?: number
): number {
  const ts = inst.clipTimestamp ?? 0;
  if (
    inst.type === "video" &&
    inst.videoLoopEnabled &&
    typeof clipDurationSec === "number" &&
    clipDurationSec > ts
  ) {
    return Math.max(loopUnitSec, clipDurationSec - ts);
  }
  return loopUnitSec;
}

function buildVideoPrepChain(
  inIdx: number,
  inst: ClipEffectInstance,
  isImage: boolean,
  trimStart: number,
  trimEnd: number | null | undefined,
  loopUnitSec: number,
  displayDur: number,
  ts: number
): string {
  if (isImage) {
    return `[${inIdx}:v]trim=duration=${fmt(displayDur + ts)},setpts=PTS-STARTPTS`;
  }

  const hasTrimEnd =
    typeof trimEnd === "number" && trimEnd > trimStart + 0.001;
  const unitTrim = hasTrimEnd
    ? `trim=start=${fmt(trimStart)}:end=${fmt(trimEnd)},setpts=PTS-STARTPTS`
    : `trim=start=${fmt(trimStart)},setpts=PTS-STARTPTS`;

  if (inst.videoLoopEnabled && loopUnitSec > 0.01 && displayDur > loopUnitSec + 0.001) {
    const loopCount = Math.max(0, Math.ceil(displayDur / loopUnitSec) - 1);
    const loopSize = Math.min(32767, Math.max(1, Math.ceil(loopUnitSec * 60)));
    return `[${inIdx}:v]${unitTrim},loop=loop=${loopCount}:size=${loopSize}:start=0,trim=duration=${fmt(displayDur)},setpts=PTS-STARTPTS,tpad=start_duration=${fmt(ts)}:start_mode=add`;
  }

  return `[${inIdx}:v]${unitTrim},tpad=start_duration=${fmt(ts)}:start_mode=add`;
}

/**
 * Overlay chain: [baseLabel] → …overlays… → [outLabel]
 * baseLabel/outLabel without brackets.
 */
export function buildVideoOverlayFilters(
  effects: LoadedExportEffect[],
  inputIndexes: number[],
  frameW: number,
  frameH: number,
  baseLabel: string,
  outLabel: string,
  /** Disambiguate overlay labels when multiple segments share one filter graph. */
  labelPrefix = "",
  /** Clip duration for video overlay loop (seconds). */
  clipDurationSec?: number
): string {
  const visualFx: Array<{ effect: LoadedExportEffect; inIdx: number }> = [];
  for (let i = 0; i < effects.length; i++) {
    const t = effects[i].instance.type;
    if (t === "video" || t === "image") {
      visualFx.push({ effect: effects[i], inIdx: inputIndexes[i] });
    }
  }
  if (visualFx.length === 0) {
    return `[${baseLabel}]null[${outLabel}]`;
  }

  const parts: string[] = [];
  let prev = baseLabel;

  for (let i = 0; i < visualFx.length; i++) {
    const { effect, inIdx } = visualFx[i];
    const inst = effect.instance;
    const lib = effect.libraryItem;
    const isImage = inst.type === "image";
    const ts = inst.clipTimestamp ?? 0;
    const trimStart = inst.sourceTrimStart ?? 0;
    const trimEnd = inst.sourceTrimEnd;
    const partDur = partDurationSeconds(inst);
    const displayDur = overlayDisplayDuration(inst, partDur, clipDurationSec);
    const pw = (inst.positionWidth ?? 100) / 100;
    const ph = (inst.positionHeight ?? 100) / 100;
    const px = (inst.positionX ?? 0) / 100;
    const py = (inst.positionY ?? 0) / 100;
    const ow = Math.max(2, even(frameW * pw));
    const oh = Math.max(2, even(frameH * ph));
    const ox = Math.round(frameW * px);
    const oy = Math.round(frameH * py);

    const rawFadeIn =
      typeof inst.fadeInSeconds === "number" ? inst.fadeInSeconds : 0;
    const rawFadeOut =
      typeof inst.fadeOutSeconds === "number" ? inst.fadeOutSeconds : 0;
    const { fadeIn, fadeOut } = normalizeVisualFades(
      displayDur,
      rawFadeIn,
      rawFadeOut
    );

    const ovLabel = `${labelPrefix}ov${i}`;
    const nextLabel = i === visualFx.length - 1 ? outLabel : `${labelPrefix}vt${i}`;
    const windowEnd = ts + displayDur;

    const prep = buildVideoPrepChain(
      inIdx,
      inst,
      isImage,
      trimStart,
      trimEnd,
      partDur,
      displayDur,
      ts
    );

    const bgMode: BackgroundRemovalMode = isImage
      ? "none"
      : parseBackgroundRemovalMode(lib.backgroundRemovalMode);
    const color = hexToFfmpegColor(lib.chromaKeyColor ?? "#000000");
    const sim =
      typeof lib.chromaKeySimilarity === "number"
        ? lib.chromaKeySimilarity
        : 0.2;
    const blend =
      typeof lib.chromaKeyBlend === "number" ? lib.chromaKeyBlend : 0.1;

    const keyFilter = buildBackgroundKeyFilterExpr(
      bgMode,
      color,
      sim,
      blend,
      fmt
    );

    const filters: string[] = [prep, `scale=${ow}:${oh}`];

    if (bgMode === "screen" && !isImage) {
      const passLabel = `${labelPrefix}scr_pass${i}`;
      const cropSrcLabel = `${labelPrefix}scr_src${i}`;
      const cropLabel = `${labelPrefix}scr_crop${i}`;
      const blendLabel = `${labelPrefix}scr_reg${i}`;
      const blendRgb = `${labelPrefix}scr_reg_rgb${i}`;
      const passRgb = `${labelPrefix}scr_pass_rgb${i}`;
      parts.push(`${prep},scale=${ow}:${oh},format=rgb24[${ovLabel}]`);
      parts.push(`[${prev}]split=2[${passLabel}][${cropSrcLabel}]`);
      parts.push(`[${cropSrcLabel}]crop=${ow}:${oh}:${ox}:${oy},format=rgb24[${cropLabel}]`);
      parts.push(
        `[${cropLabel}][${ovLabel}]blend=all_mode=screen:enable='between(t\\,${fmt(ts)}\\,${fmt(windowEnd)})'[${blendLabel}]`
      );
      parts.push(`[${blendLabel}]format=rgb24[${blendRgb}]`);
      parts.push(`[${passLabel}]format=rgb24[${passRgb}]`);
      parts.push(
        `[${passRgb}][${blendRgb}]overlay=x=${ox}:y=${oy}:enable='between(t\\,${fmt(ts)}\\,${fmt(windowEnd)})'[${nextLabel}_rgb]`
      );
      parts.push(`[${nextLabel}_rgb]format=yuv420p[${nextLabel}]`);
      prev = nextLabel;
      continue;
    }

    filters.push("format=yuva420p");
    if (keyFilter) {
      filters.push(keyFilter);
    }
    if (fadeIn > 0) {
      filters.push(`fade=t=in:st=${fmt(ts)}:d=${fmt(fadeIn)}:alpha=1`);
    }
    if (fadeOut > 0 && displayDur > fadeOut) {
      filters.push(
        `fade=t=out:st=${fmt(ts + displayDur - fadeOut)}:d=${fmt(fadeOut)}:alpha=1`
      );
    }
    parts.push(`${filters.join(",")}[${ovLabel}]`);
    parts.push(
      `[${prev}][${ovLabel}]overlay=x=${ox}:y=${oy}:enable='between(t\\,${fmt(ts)}\\,${fmt(windowEnd)})':format=auto:eof_action=pass[${nextLabel}]`
    );
    prev = nextLabel;
  }

  return parts.join(";");
}

function duckVolumeExpr(effects: LoadedExportEffect[]): string | null {
  const windows: Array<{ start: number; end: number }> = [];
  for (const { instance, libraryItem } of effects) {
    if (instance.type !== "music" || !instance.duckingEnabled) continue;
    const start = instance.clipTimestamp ?? 0;
    const trimStart = instance.sourceTrimStart ?? 0;
    const trimEnd = instance.sourceTrimEnd;
    const dur =
      typeof trimEnd === "number" && trimEnd > trimStart
        ? trimEnd - trimStart
        : Math.max(0.1, (libraryItem.durationSeconds ?? 1) - trimStart);
    windows.push({ start, end: start + dur });
  }
  if (windows.length === 0) return null;
  const checks = windows
    .map((w) => `between(t\\,${fmt(w.start)}\\,${fmt(w.end)})`)
    .join("+");
  return `if(gt(${checks}\\,0)\\,0.35\\,1)`;
}

/**
 * Mix music/sfx onto a main audio label (no brackets), producing [aout].
 * Does not touch [0:a] — caller must already expose mainLabel.
 */
export function buildAudioFxMixOntoLabel(
  effects: LoadedExportEffect[],
  inputIndexes: number[],
  mainLabel: string,
  labelPrefix = ""
): string | null {
  const audioFx: Array<{ effect: LoadedExportEffect; inIdx: number }> = [];
  for (let i = 0; i < effects.length; i++) {
    const t = effects[i].instance.type;
    if (t === "music" || t === "sfx") {
      audioFx.push({ effect: effects[i], inIdx: inputIndexes[i] });
    }
  }
  if (audioFx.length === 0) return null;

  const parts: string[] = [];
  const mixLabels = [`[${mainLabel}]`];

  for (let i = 0; i < audioFx.length; i++) {
    const { effect, inIdx } = audioFx[i];
    const inst = effect.instance;
    const ts = inst.clipTimestamp ?? 0;
    const trimStart = inst.sourceTrimStart ?? 0;
    const trimEnd = inst.sourceTrimEnd;
    const vol = typeof inst.volume === "number" ? inst.volume : 1;
    const fadeIn =
      inst.type === "music" && typeof inst.fadeInSeconds === "number"
        ? Math.max(0, inst.fadeInSeconds)
        : 0;
    const fadeOut =
      inst.type === "music" && typeof inst.fadeOutSeconds === "number"
        ? Math.max(0, inst.fadeOutSeconds)
        : 0;

    const trimDur =
      typeof trimEnd === "number" && trimEnd > trimStart
        ? trimEnd - trimStart
        : null;
    const atrim =
      typeof trimEnd === "number" && trimDur != null
        ? `atrim=start=${fmt(trimStart)}:end=${fmt(trimEnd)},asetpts=PTS-STARTPTS`
        : `atrim=start=${fmt(trimStart)},asetpts=PTS-STARTPTS`;

    const filters = [atrim, `volume=${fmt(vol)}`];
    if (fadeIn > 0) {
      filters.push(`afade=t=in:st=0:d=${fmt(fadeIn)}`);
    }
    if (fadeOut > 0 && trimDur != null && trimDur > fadeOut) {
      filters.push(
        `afade=t=out:st=${fmt(trimDur - fadeOut)}:d=${fmt(fadeOut)}`
      );
    }
    const delayMs = Math.max(0, Math.round(ts * 1000));
    if (delayMs > 0) {
      filters.push(`adelay=${delayMs}:all=1`);
    }

    const label = `${labelPrefix}afx${i}`;
    parts.push(`[${inIdx}:a]${filters.join(",")}[${label}]`);
    mixLabels.push(`[${label}]`);
  }

  parts.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0[aout]`
  );
  return parts.join(";");
}

/**
 * Build [0:a] → (optional tempo) → (optional duck) → [amain] fragment.
 * Returns null if identity (caller can use [0:a] directly).
 */
export function buildMainAudioPrepare(
  effects: LoadedExportEffect[],
  tempoFilter: string | null
): string | null {
  const duck = duckVolumeExpr(effects);
  if (!tempoFilter && !duck) return null;
  if (tempoFilter && duck) {
    return `[0:a]${tempoFilter},volume='${duck}':eval=frame[amain]`;
  }
  if (tempoFilter) {
    return `[0:a]${tempoFilter}[amain]`;
  }
  return `[0:a]volume='${duck}':eval=frame[amain]`;
}
