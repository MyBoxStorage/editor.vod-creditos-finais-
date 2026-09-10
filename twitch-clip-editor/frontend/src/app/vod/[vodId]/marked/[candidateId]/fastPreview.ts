import type { ClipEffectInstance, ClipTranscript } from "../../../../../lib/api";
import { ffmpegLinearFadeOpacity } from "../../../../../lib/overlayFade";
import type { ColorPresetUi, SpeedRampRow, ZoomKeyframeRow } from "./types";
import { sourcePartDurationSeconds } from "./effectTiming";

export type FastPreviewState = {
  zoomKeyframes: ZoomKeyframeRow[];
  colorPreset: ColorPresetUi;
  colorIntensityPercent: number;
  colorEffectStart?: number;
  colorEffectEnd?: number;
  speed: number;
  speedRamp: SpeedRampRow[];
  appliedEffects: ClipEffectInstance[];
  useSubtitles: boolean;
  transcript: ClipTranscript | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function interpolateZoomAt(
  keyframes: ZoomKeyframeRow[],
  t: number
): { scale: number; x: number; y: number } {
  if (keyframes.length === 0) {
    return { scale: 1, x: 50, y: 50 };
  }
  const pts = [...keyframes].sort((a, b) => a.time - b.time);
  if (t <= pts[0].time) {
    return { scale: pts[0].scale, x: pts[0].x, y: pts[0].y };
  }
  if (t >= pts[pts.length - 1].time) {
    const last = pts[pts.length - 1];
    return { scale: last.scale, x: last.x, y: last.y };
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.time && t <= b.time) {
      const dt = b.time - a.time;
      const ratio = dt === 0 ? 0 : (t - a.time) / dt;
      return {
        scale: a.scale + (b.scale - a.scale) * ratio,
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
      };
    }
  }
  const last = pts[pts.length - 1];
  return { scale: last.scale, x: last.x, y: last.y };
}

export function zoomTransformStyle(
  keyframes: ZoomKeyframeRow[],
  t: number
): { transform: string; transformOrigin: string } {
  const { scale, x, y } = interpolateZoomAt(keyframes, t);
  if (Math.abs(scale - 1) < 0.001) {
    return { transform: "none", transformOrigin: "50% 50%" };
  }
  const tx = (50 - x) * (scale - 1);
  const ty = (50 - y) * (scale - 1);
  return {
    transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
    transformOrigin: `${x}% ${y}%`,
  };
}

function colorWeight(
  t: number,
  start?: number,
  end?: number
): number {
  if (start == null || end == null || !(end > start)) return 1;
  if (t < start || t > end) return 0;
  const fade = Math.min(0.45, (end - start) * 0.12);
  if (fade <= 0) return 1;
  if (t < start + fade) return (t - start) / fade;
  if (t > end - fade) return (end - t) / fade;
  return 1;
}

export function colorFilterStyle(
  preset: ColorPresetUi,
  intensityPercent: number,
  t: number,
  effectStart?: number,
  effectEnd?: number
): string {
  if (preset === "none") return "none";
  const f = intensityPercent / 100;
  const w = colorWeight(t, effectStart, effectEnd);
  if (w <= 0) return "none";

  const mix = (base: number, target: number) =>
    1 + (target - 1) * f * w;

  switch (preset) {
    case "vivid":
      return `saturate(${mix(1, 1.15)}) contrast(${mix(1, 1.08)}) brightness(${mix(1, 1.02)})`;
    case "vivid_contrast":
      return `saturate(${mix(1, 1.15)}) contrast(${mix(1, 1.18)})`;
    case "cold_desaturated":
      return `saturate(${mix(1, 0.72)}) contrast(${mix(1, 0.98)}) hue-rotate(-8deg)`;
    case "wasted_grayscale": {
      const gray = clamp01(f * w);
      return `grayscale(${gray}) contrast(${mix(1, 1.05)})`;
    }
    default:
      return "none";
  }
}

export function playbackRateAt(
  t: number,
  speed: number,
  speedRamp: SpeedRampRow[]
): number {
  if (speedRamp.length === 0) return speed;
  const pts = [...speedRamp].sort((a, b) => a.time - b.time);
  if (t <= pts[0].time) return pts[0].speed;
  if (t >= pts[pts.length - 1].time) return pts[pts.length - 1].speed;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.time && t <= b.time) return a.speed;
  }
  return speed;
}

export function activeSubtitleSegment(
  transcript: ClipTranscript | null,
  t: number
): { text: string; start: number; end: number } | null {
  if (!transcript?.segments?.length) return null;
  const seg = transcript.segments.find((s) => t >= s.start && t < s.end);
  if (!seg) return null;
  return { text: seg.text, start: seg.start, end: seg.end };
}

export function activeVideoOverlays(
  effects: ClipEffectInstance[],
  t: number
): Array<{
  id: string;
  name: string;
  src: string;
  kind: "video" | "image";
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}> {
  const out: Array<{
    id: string;
    name: string;
    src: string;
    kind: "video" | "image";
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }> = [];
  for (const inst of effects) {
    const libType = inst.libraryItem?.type ?? inst.type;
    if (libType !== "video" && libType !== "image") continue;
    const clipTs = inst.clipTimestamp ?? 0;
    const partDur = sourcePartDurationSeconds(
      inst.sourceTrimStart,
      inst.sourceTrimEnd
    );
    if (t < clipTs || t > clipTs + partDur) continue;
    const filePath = inst.libraryItem?.filePath;
    if (!filePath) continue;
    const fadeIn = inst.fadeInSeconds ?? 0;
    const fadeOut = inst.fadeOutSeconds ?? 0;
    const localT = t - clipTs;
    const opacity = ffmpegLinearFadeOpacity(localT, partDur, fadeIn, fadeOut);
    if (opacity <= 0.01) continue;
    out.push({
      id: inst.id,
      name: inst.libraryItem?.name ?? libType,
      src: filePath,
      kind: libType === "image" ? "image" : "video",
      left: inst.positionX ?? 0,
      top: inst.positionY ?? 0,
      width: inst.positionWidth ?? 100,
      height: inst.positionHeight ?? 100,
      opacity,
      fadeInSeconds: fadeIn,
      fadeOutSeconds: fadeOut,
    });
  }
  return out;
}

export function activeAudioEffects(
  effects: ClipEffectInstance[],
  t: number
): ClipEffectInstance[] {
  return effects.filter((inst) => {
    if (inst.type !== "music" && inst.type !== "sfx") {
      if (inst.libraryItem?.type !== "music" && inst.libraryItem?.type !== "sfx") {
        return false;
      }
    }
    const clipTs = inst.clipTimestamp ?? 0;
    const partDur = sourcePartDurationSeconds(
      inst.sourceTrimStart,
      inst.sourceTrimEnd
    );
    return t >= clipTs && t < clipTs + partDur;
  });
}
