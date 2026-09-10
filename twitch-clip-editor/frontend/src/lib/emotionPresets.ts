/**
 * Emotion presets — mirrors backend/src/services/emotionPresets.ts (keep in sync).
 */

export type EmotionPresetId =
  | "emphasis"
  | "suspense"
  | "celebration"
  | "surprise"
  | "disappointment"
  | "wasted";

export type EmotionColorPreset =
  | "none"
  | "vivid"
  | "vivid_contrast"
  | "cold_desaturated"
  | "wasted_grayscale";

export type EmotionZoomKeyframe = {
  time: number;
  scale: number;
  x: number;
  y: number;
};

export type EmotionSpeedRampPoint = {
  time: number;
  speed: number;
};

export type EmotionPresetExpandInput = {
  presetId: EmotionPresetId;
  effectStart: number;
  effectEnd: number;
  clipDuration: number;
  intensityPercent?: number;
  /** Wasted only: screen duration of the inserted slow-mo (default 6). */
  effectDuration?: number;
};

export type EmotionPresetResult = {
  presetId: EmotionPresetId;
  effectStart: number;
  effectEnd: number;
  intensityPercent: number;
  zoomKeyframes: EmotionZoomKeyframe[];
  colorPreset: EmotionColorPreset;
  speedRamp: EmotionSpeedRampPoint[] | null;
  summary: string;
  wastedInsert?: {
    insertAtTime: number;
    effectDuration: number;
    sourceSeconds: number;
    endSpeed: number;
  };
};

export const PRESET_DEFAULT_DURATION: Record<EmotionPresetId, number> = {
  emphasis: 0.4,
  suspense: 2.5,
  celebration: 0.9,
  surprise: 0.1,
  disappointment: 1.8,
  wasted: 6,
};

export function defaultEffectRange(
  presetId: EmotionPresetId,
  clipDuration: number,
  centerTime?: number
): { effectStart: number; effectEnd: number } {
  const span = PRESET_DEFAULT_DURATION[presetId];
  const center = clamp(
    centerTime ?? clipDuration / 2,
    0,
    Math.max(0, clipDuration)
  );
  let t0 = center - span / 2;
  let t1 = center + span / 2;
  if (t0 < 0) {
    t0 = 0;
    t1 = Math.min(clipDuration, span);
  }
  if (t1 > clipDuration) {
    t1 = clipDuration;
    t0 = Math.max(0, clipDuration - span);
  }
  if (!(t1 > t0)) {
    t0 = 0;
    t1 = Math.min(clipDuration, Math.max(0.1, span));
  }
  return { effectStart: round1(t0), effectEnd: round1(t1) };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Number(n.toFixed(3));
}

export function intensityFactor(intensityPercent: number): number {
  return clamp(intensityPercent, 0, 200) / 100;
}

export function scaleZoomScale(
  baseScale: number,
  intensityPercent: number
): number {
  const f = intensityFactor(intensityPercent);
  const delta = baseScale - 1;
  return clamp(1 + delta * f, 0.5, 2.5);
}

export function scaleSpeed(baseSpeed: number, intensityPercent: number): number {
  const f = intensityFactor(intensityPercent);
  const deviation = 1 - baseSpeed;
  return clamp(1 - deviation * f, 0.5, 1.0);
}

/** Wasted end speed: clamp(1 - 0.55 * f, 0.25, 1) — @100% = 0.45x. */
export function scaleWastedEndSpeed(intensityPercent: number): number {
  const f = intensityFactor(intensityPercent);
  return clamp(1 - 0.55 * f, 0.25, 1.0);
}

function normalizeEffectRange(
  effectStart: number,
  effectEnd: number,
  clipDuration: number
): { t0: number; t1: number; duration: number } {
  const clip = Math.max(0.1, clipDuration);
  const t0 = clamp(effectStart, 0, clip);
  let t1 = clamp(effectEnd, 0, clip);
  if (t1 <= t0) {
    t1 = Math.min(clip, t0 + 0.1);
  }
  return {
    t0: round1(t0),
    t1: round1(t1),
    duration: round1(Math.max(0.1, t1 - t0)),
  };
}

function centerKf(
  time: number,
  scale: number,
  x = 50,
  y = 50
): EmotionZoomKeyframe {
  return { time: round1(time), scale, x, y };
}

function rampOnWindow(
  t0: number,
  t1: number,
  speed: number
): EmotionSpeedRampPoint[] {
  const pts: EmotionSpeedRampPoint[] = [];
  if (t0 > 0) {
    pts.push({ time: 0, speed: 1 });
  }
  pts.push({ time: round1(t0), speed });
  pts.push({ time: round1(t1), speed: 1 });
  return pts;
}

/** Gradual zoom-out + shake for fast preview (mirrors wasted camera startS→1). */
export function buildWastedZoomKeyframes(
  effectStart: number,
  effectEnd: number,
  intensityPercent: number
): EmotionZoomKeyframe[] {
  const duration = Math.max(0.1, effectEnd - effectStart);
  const f = intensityFactor(intensityPercent);
  const recipeStart = clamp(1 / (1 - 0.07 * f), 1, 1 / 0.85);
  const startScale = Number(recipeStart.toFixed(4));
  const steps = 12;
  const keyframes: EmotionZoomKeyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const t = round1(effectStart + duration * frac);
    const scale = Number((startScale + (1 - startScale) * frac).toFixed(4));
    const shakeAmp = 1.5 * f;
    const phase = frac * Math.PI * 4;
    const x = Number((50 + Math.sin(phase) * shakeAmp).toFixed(2));
    const y = Number((50 + Math.cos(phase * 1.3) * shakeAmp * 0.6).toFixed(2));
    keyframes.push(centerKf(t, scale, x, y));
  }
  keyframes.push(centerKf(round1(effectEnd + 0.001), 1, 50, 50));
  return keyframes;
}

function formatRange(t0: number, t1: number): string {
  return `${formatClock(t0)}–${formatClock(t1)}`;
}

function formatClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function expandEmotionPreset(
  input: EmotionPresetExpandInput
): EmotionPresetResult {
  const { presetId } = input;
  const clipDuration = Math.max(0.1, input.clipDuration);
  const intensityPercent = clamp(input.intensityPercent ?? 100, 0, 200);
  const { t0, t1, duration } = normalizeEffectRange(
    input.effectStart,
    input.effectEnd,
    clipDuration
  );

  if (presetId === "emphasis") {
    const punchEnd = round1(t0 + duration * 0.375);
    const peak = scaleZoomScale(1.15, intensityPercent);
    return {
      presetId,
      effectStart: t0,
      effectEnd: t1,
      intensityPercent,
      zoomKeyframes: [
        centerKf(t0, 1.0),
        centerKf(punchEnd, peak),
        centerKf(t1, peak),
      ],
      colorPreset: "vivid",
      speedRamp: null,
      summary: `Ênfase ${formatRange(t0, t1)} — punch 1.0→${peak.toFixed(2)}, ${intensityPercent}%`,
    };
  }

  if (presetId === "suspense") {
    const peak = scaleZoomScale(1.15, intensityPercent);
    const spd = scaleSpeed(0.9, intensityPercent);
    return {
      presetId,
      effectStart: t0,
      effectEnd: t1,
      intensityPercent,
      zoomKeyframes: [centerKf(t0, 1.0), centerKf(t1, peak)],
      colorPreset: "cold_desaturated",
      speedRamp: rampOnWindow(t0, t1, spd),
      summary: `Suspense ${formatRange(t0, t1)} — zoom gradual 1.0→${peak.toFixed(2)}, ${spd.toFixed(2)}x, ${intensityPercent}%`,
    };
  }

  if (presetId === "celebration") {
    const peak = scaleZoomScale(1.1, intensityPercent);
    const shakeAmp = 2 * intensityFactor(intensityPercent);
    const fracs = [0, 0.067, 0.133, 0.2, 0.267, 0.333, 1.0];
    const scales = [1.0, 1.02, 1.04, 1.06, 1.08, 1.09, peak];
    const xs = [50, 50 + shakeAmp, 50 - shakeAmp, 50 + shakeAmp, 50 - shakeAmp, 50, 50];
    const ys = [50, 50, 51, 49, 50, 50, 50];
    const zoomKeyframes = fracs.map((frac, i) => {
      const baseScale = scales[i];
      const scaled =
        i === 0 ? 1.0 : scaleZoomScale(baseScale, intensityPercent);
      return centerKf(
        round1(t0 + duration * frac),
        scaled,
        xs[i],
        ys[i]
      );
    });
    return {
      presetId,
      effectStart: t0,
      effectEnd: t1,
      intensityPercent,
      zoomKeyframes,
      colorPreset: "vivid",
      speedRamp: null,
      summary: `Comemoração ${formatRange(t0, t1)} — push-in + shake, ${intensityPercent}%`,
    };
  }

  if (presetId === "surprise") {
    const whipEnd = round1(t0 + Math.max(duration * 0.1, duration * 0.05));
    const peak = scaleZoomScale(1.2, intensityPercent);
    return {
      presetId,
      effectStart: t0,
      effectEnd: t1,
      intensityPercent,
      zoomKeyframes: [
        centerKf(t0, 1.0),
        centerKf(whipEnd, peak),
        centerKf(t1, peak),
      ],
      colorPreset: "vivid_contrast",
      speedRamp: null,
      summary: `Surpresa ${formatRange(t0, t1)} — whip 1.0→${peak.toFixed(2)}, ${intensityPercent}%`,
    };
  }

  if (presetId === "disappointment") {
    const startScale = scaleZoomScale(1.05, intensityPercent);
    const spd = scaleSpeed(0.85, intensityPercent);
    return {
      presetId,
      effectStart: t0,
      effectEnd: t1,
      intensityPercent,
      zoomKeyframes: [centerKf(t0, startScale), centerKf(t1, 1.0)],
      colorPreset: "cold_desaturated",
      speedRamp: rampOnWindow(t0, t1, spd),
      summary: `Decepção ${formatRange(t0, t1)} — zoom out ${startScale.toFixed(2)}→1.0, ${spd.toFixed(2)}x, ${intensityPercent}%`,
    };
  }

  if (presetId === "wasted") {
    const insertAt = clamp(input.effectStart, 0, clipDuration);
    const effectDuration = Math.max(
      0.5,
      input.effectDuration ??
        (input.effectEnd > input.effectStart
          ? input.effectEnd - input.effectStart
          : PRESET_DEFAULT_DURATION.wasted)
    );
    const effectEnd = round1(Math.min(clipDuration, insertAt + effectDuration));
    const dur = round1(effectEnd - insertAt);
    const endSpeed = scaleWastedEndSpeed(intensityPercent);
    const finalSat = clamp(1 - intensityFactor(intensityPercent), 0, 1);
    return {
      presetId,
      effectStart: round1(insertAt),
      effectEnd,
      intensityPercent,
      zoomKeyframes: buildWastedZoomKeyframes(insertAt, effectEnd, intensityPercent),
      colorPreset: "wasted_grayscale",
      speedRamp: rampOnWindow(insertAt, effectEnd, endSpeed),
      summary: `Wasted ${formatRange(insertAt, effectEnd)} — P&B→${finalSat.toFixed(2)}, ${endSpeed.toFixed(2)}x, zoom-out, ${intensityPercent}%`,
    };
  }

  throw new Error(`Unknown emotion preset: ${presetId}`);
}

export const EMOTION_PRESET_META: Array<{
  id: EmotionPresetId;
  label: string;
  mark: string;
}> = [
  { id: "emphasis", label: "Ênfase", mark: "En" },
  { id: "suspense", label: "Suspense", mark: "Su" },
  { id: "celebration", label: "Comemoração", mark: "Co" },
  { id: "surprise", label: "Surpresa", mark: "Sp" },
  { id: "disappointment", label: "Decepção", mark: "De" },
  { id: "wasted", label: "Wasted", mark: "Wa" },
];
