import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { getDataDir } from "./vodIngest";
import { getCurrentRun } from "./pipelineRun";
import { getLayoutPreset } from "../pipeline/layoutPresets";
import { getCaptionFontsDir, writeClipCaptions } from "../pipeline/captionGenerator";
import {
  buildFilterComplex,
  runFfmpeg,
} from "../pipeline/clipRenderer";
import {
  ensurePreviewForInterval,
  resolveCachedPreviewDuration,
} from "./previewIntegrity";
import {
  pushCappedPreviewInput,
  resolveMarkedClipDuration,
} from "./clipDuration";
import {
  findClipEditableById,
  saveClipEditable,
  type ClipEditable,
} from "./clipEditable";
import {
  evenDim,
  getQualityPreset,
  type QualityId,
} from "./qualityPresets";
import { loadEffectsForExport } from "./effectsLibraryService";
import {
  appendEffectInputs,
  buildAudioFxMixOntoLabel,
  buildMainAudioPrepare,
  buildVideoOverlayFilters,
  hasAudioEffects,
  hasVideoEffects,
} from "./effectsExportFilters";
import {
  mergeSubtitleRenderSnapshot,
  type SubtitleRenderSnapshot,
  type Transcript,
} from "./transcribeService";

export type ZoomKeyframe = {
  time: number;
  scale: number;
  x: number;
  y: number;
};

export type SpeedRampPoint = {
  time: number;
  speed: number;
};

export type ColorPresetId =
  | "none"
  | "vivid"
  | "vivid_contrast"
  | "cold_desaturated"
  | "wasted_grayscale";

export type ExportCandidateInput = {
  useSubtitles: boolean;
  subtitleRange: { start: number; end: number } | null;
  quality: QualityId;
  /** Uniform clip speed. Ignored when speedRamp is a non-empty array. */
  speed: number;
  /** Layout preset id (e.g. vertical-split-9x16, horizontal-16x9). */
  preset: string;
  /** Optional punch-in keyframes (clip-relative seconds). Empty/absent = no zoom. */
  zoomKeyframes?: ZoomKeyframe[];
  /** Optional piecewise-constant speed ramp. When non-empty, replaces `speed`. */
  speedRamp?: SpeedRampPoint[];
  /** Optional color grade. Absent/"none" = no-op. */
  colorPreset?: ColorPresetId;
  /** 0–200, scales color preset magnitude (100 = recipe baseline). */
  colorIntensityPercent?: number;
  /**
   * Clip-relative window for color grade (emotion presets).
   * Both required together; when set, color is identity outside the range.
   */
  colorEffectStart?: number;
  colorEffectEnd?: number;
  /** Soft edge for color window; omit = auto soft (hard if window < 0.35s). */
  colorFadeSeconds?: number;
  /**
   * Optional pre-intro payoff hook (preview-relative seconds).
   * Both required together; must be a subset of [0, previewDuration].
   * When set: [hook] + [main]. Hook never gets subtitles; auto zoom 1.0→1.12.
   */
  hookStart?: number;
  hookEnd?: number;
  /**
   * Wasted emotion preset: insert slow-mo segment (adds effectDuration to
   * timeline). When set, ignores in-place zoom/speedRamp/color for the main path.
   */
  wastedInsert?: {
    insertAtTime: number;
    effectDuration: number;
    intensityPercent?: number;
  };
  /**
   * Optional list of preset applications (Sprint 5+). When length > 1, applied
   * sequentially. When absent, legacy single-preset fields are used unchanged.
   */
  presetApplications?: PresetApplicationPayload[];
  /** Editor live subtitle state (faithful preview cache + burn). */
  subtitleSnapshot?: SubtitleRenderSnapshot;
  /** Clip-relative window within preview material (omit = full material). */
  clipRange?: { start: number; end: number } | null;
};

export type PresetApplicationPayload = {
  presetId: string;
  effectStart: number;
  effectEnd: number;
  effectDuration?: number;
  intensityPercent: number;
  zoomKeyframes?: ZoomKeyframe[];
  speedRamp?: SpeedRampPoint[];
  colorPreset?: ColorPresetId;
  colorEffectStart?: number;
  colorEffectEnd?: number;
  colorFadeSeconds?: number;
};

/** Auto zoom for the hook segment (relative to trimmed hook, t=0…duration). */
const HOOK_ZOOM_SCALE_START = 1.0;
const HOOK_ZOOM_SCALE_END = 1.12;
const HOOK_ZOOM_X = 50;
const HOOK_ZOOM_Y = 50;

export type ExportCandidateResult = {
  candidate: ClipEditable;
  prontosPath: string;
  prontosRelativePath: string;
  runId: string;
  elapsedMs: number;
  /** Set when preview media is shorter than the marked interval. */
  previewShorterThanMarked?: boolean;
};

/** Preview-render uses NVENC; export final keeps libx264/x265 (contract §8). */
export type PreviewVideoEncoder = "libx264" | "h264_nvenc";

export function appendVideoEncoderArgs(
  args: string[],
  opts: {
    encoder: PreviewVideoEncoder;
    crf: number;
    x264Preset: string;
    audioBitrate: string;
    outputPath: string;
  }
): void {
  if (opts.encoder === "h264_nvenc") {
    args.push(
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p4",
      "-tune",
      "ll",
      "-cq",
      String(Math.min(opts.crf + 6, 32)),
      "-c:a",
      "aac",
      "-b:a",
      opts.audioBitrate,
      "-movflags",
      "+faststart",
      opts.outputPath
    );
  } else {
    args.push(
      "-c:v",
      "libx264",
      "-crf",
      String(opts.crf),
      "-preset",
      opts.x264Preset,
      "-c:a",
      "aac",
      "-b:a",
      opts.audioBitrate,
      "-movflags",
      "+faststart",
      opts.outputPath
    );
  }
}

/**
 * Optional temporal window for color grade (clip-relative seconds).
 * When set, color is identity outside [start, end] — fixes full-clip bleed.
 */
export type ColorEffectTiming = {
  start: number;
  end: number;
  /**
   * Soft edge length in seconds. 0 = hard cut.
   * Omit → auto: soft (~12% of window, capped 0.45s) unless window < 0.35s.
   */
  fadeSeconds?: number;
};

/**
 * Weight 0→1→0 over [start, end] with optional linear fades.
 * Commas escaped for ffmpeg filtergraph expressions (same style as zoom).
 */
export function colorWeightExpr(
  start: number,
  end: number,
  fadeSeconds: number
): string {
  const S = fmt(start);
  const E = fmt(end);
  if (!(end > start)) {
    return "0";
  }
  const dur = end - start;
  let fade = Math.max(0, fadeSeconds);
  if (fade * 2 >= dur) {
    fade = Math.max(0, dur / 2 - 0.001);
  }
  if (fade <= 0.001) {
    return `if(between(t\\,${S}\\,${E})\\,1\\,0)`;
  }
  const F = fmt(fade);
  // 0 | ramp in | plateau 1 | ramp out | 0
  return `if(lt(t\\,${S})\\,0\\,if(lt(t\\,${S}+${F})\\,(t-${S})/${F}\\,if(lt(t\\,${E}-${F})\\,1\\,if(lt(t\\,${E})\\,(${E}-t)/${F}\\,0))))`;
}

function resolveColorFadeSeconds(
  timing: ColorEffectTiming
): number {
  const dur = Math.max(0, timing.end - timing.start);
  if (typeof timing.fadeSeconds === "number") {
    return Math.max(0, timing.fadeSeconds);
  }
  // Soft by default (Decepção / Suspense); short punches stay hard.
  if (dur < 0.35) return 0;
  return Math.min(0.45, dur * 0.12);
}

/** Normalize optional color window; null if missing/invalid. */
export function normalizeColorEffectTiming(
  start: number | undefined,
  end: number | undefined,
  fadeSeconds?: number
): ColorEffectTiming | null {
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!(end > start)) return null;
  const timing: ColorEffectTiming = {
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
  };
  if (typeof fadeSeconds === "number") {
    timing.fadeSeconds = fadeSeconds;
  }
  return timing;
}

/**
 * Color grade filter. Without timing → full clip (manual advanced UI).
 * With timing → eq params lerp via eval=frame; colorbalance gated with enable.
 * Applied before setpts so `t` matches zoom (clip-relative source time).
 *
 * wasted_grayscale (death screen): sat ramps 1→finalSat early in the window
 * (~45% of duration), HOLDS full desat, then short fade-back at the end.
 */
export function colorPresetFilterExpr(
  preset: ColorPresetId,
  intensityPercent = 100,
  timing?: ColorEffectTiming | null
): string | null {
  if (preset === "none") return null;
  const f = Math.max(0, Math.min(200, intensityPercent)) / 100;

  // --- Wasted: progressive neutral desat (no green/olive cast) ---
  // eq=saturation alone shifts chroma unevenly on game/skin content.
  // hue=s= uses HSL saturation → progressive path toward neutral gray.
  if (preset === "wasted_grayscale") {
    // Intensity: finalSat = max(0, 1 - f). @100% → 0 (B&W), @50% → 0.5, @200% → 0.
    const finalSat = clampNum(1 - f, 0, 1);
    const hasWindow =
      timing != null &&
      typeof timing.start === "number" &&
      typeof timing.end === "number" &&
      timing.end > timing.start;

    if (!hasWindow || !timing) {
      return `hue=s=${fmt(finalSat)}`;
    }

    const S = timing.start;
    const E = timing.end;
    const dur = Math.max(0.001, E - S);
    // Soft return to color in the last ~0.25s (death insert is self-contained).
    const fadeBack = Math.min(
      typeof timing.fadeSeconds === "number" ? timing.fadeSeconds : 0.25,
      dur * 0.25
    );
    // Hit full desat by ~45% of the effect, then hold B&W until fade-back.
    const satPeakAt = S + dur * 0.45;
    const fadeStart = Math.max(satPeakAt + 0.05, E - Math.max(0.05, fadeBack));
    const Ss = fmt(S);
    const Es = fmt(E);
    const PeakS = fmt(satPeakAt);
    const FadeS = fmt(fadeStart);
    const RampDur = fmt(Math.max(0.001, satPeakAt - S));
    const FadeDur = fmt(Math.max(0.05, E - fadeStart));
    // 0 → ramp to 1 by satPeakAt → hold 1 until fadeStart → ramp to 0 by E
    const progress = `if(lt(t\\,${Ss})\\,0\\,if(lt(t\\,${PeakS})\\,(t-${Ss})/${RampDur}\\,if(lt(t\\,${FadeS})\\,1\\,if(lt(t\\,${Es})\\,1-(t-${FadeS})/${FadeDur}\\,0))))`;
    return `hue=s='1+(${fmt(finalSat)}-1)*(${progress})'`;
  }

  let contrast = 1;
  let saturation = 1;
  let brightness = 0;
  let rs: number | null = null;
  let bs: number | null = null;

  if (preset === "vivid") {
    // Baseline @100%: contrast +0.08, saturation +0.15, brightness +0.02
    contrast = clampNum(1 + 0.08 * f, 0.85, 1.35);
    saturation = clampNum(1 + 0.15 * f, 0.5, 1.65);
    brightness = clampNum(0.02 * f, -0.06, 0.08);
  } else if (preset === "vivid_contrast") {
    // Baseline @100%: contrast +0.18, saturation +0.15
    contrast = clampNum(1 + 0.18 * f, 0.9, 1.45);
    saturation = clampNum(1 + 0.15 * f, 0.5, 1.65);
    brightness = clampNum(0.02 * f, -0.04, 0.08);
  } else if (preset === "cold_desaturated") {
    // Baseline @100%: sat 0.72 (−0.28), contrast 0.98, blue push via colorbalance
    saturation = clampNum(1 - 0.28 * f, 0.35, 1);
    contrast = clampNum(1 - 0.02 * f, 0.85, 1.05);
    brightness = clampNum(-0.015 * f, -0.08, 0.02);
    rs = clampNum(-0.04 * f, -0.12, 0);
    bs = clampNum(0.06 * f, 0, 0.15);
  } else {
    return null;
  }

  const hasWindow =
    timing != null &&
    typeof timing.start === "number" &&
    typeof timing.end === "number" &&
    timing.end > timing.start;

  if (!hasWindow || !timing) {
    // Full-clip (legacy / advanced color without emotion window)
    const eq = `eq=contrast=${fmt(contrast)}:saturation=${fmt(saturation)}:brightness=${fmt(brightness)}`;
    if (rs != null && bs != null) {
      return `${eq},colorbalance=rs=${fmt(rs)}:bs=${fmt(bs)}`;
    }
    return eq;
  }

  const fade = resolveColorFadeSeconds(timing);
  const w = colorWeightExpr(timing.start, timing.end, fade);
  // Identity outside window: contrast/sat → 1, brightness → 0
  const eq = `eq=contrast='1+(${fmt(contrast)}-1)*(${w})':saturation='1+(${fmt(saturation)}-1)*(${w})':brightness='(${fmt(brightness)})*(${w})':eval=frame`;

  if (rs != null && bs != null) {
    // colorbalance coeffs are not expressions — gate with enable (same window).
    // Soft fade is carried by eq; blue push is hard-gated to the interval.
    const S = fmt(timing.start);
    const E = fmt(timing.end);
    return `${eq},colorbalance=rs=${fmt(rs)}:bs=${fmt(bs)}:enable='between(t\\,${S}\\,${E})'`;
  }
  return eq;
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function isKnownColorPreset(id: string): id is ColorPresetId {
  return (
    id === "none" ||
    id === "vivid" ||
    id === "vivid_contrast" ||
    id === "cold_desaturated" ||
    id === "wasted_grayscale"
  );
}

export function probeMediaDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

/**
 * Cascade atempo filters so each factor stays in ffmpeg's supported range.
 * Preserves pitch (unlike asetrate). Prefer buildPitchPreservingTempo for
 * Wasted slow-mo (rubberband when available).
 */
export function buildAtempoChain(speed: number): string {
  if (!(speed > 0)) {
    throw new Error("speed must be > 0");
  }
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2 + 1e-9) {
    parts.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    parts.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-6) {
    parts.push(`atempo=${Number(remaining.toFixed(6))}`);
  }
  return parts.join(",");
}

/**
 * Pitch-preserving tempo change for Wasted insert audio.
 * rubberband keeps pitch stable at extreme slowdowns; atempo can sound
 * "vinyl/robotic" when chained. Falls back to atempo if rubberband unavailable
 * at runtime (filter string still valid when ffmpeg is built with librubberband).
 */
export function buildPitchPreservingTempo(speed: number): string {
  if (!(speed > 0)) {
    throw new Error("speed must be > 0");
  }
  if (Math.abs(speed - 1) < 1e-6) {
    return "";
  }
  // tempo=speed: play faster/slower; pitch=1 keeps original pitch.
  return `rubberband=tempo=${Number(speed.toFixed(6))}:pitch=1`;
}

/** Normalize + validate zoom keyframes. Returns null if absent/empty. */
export function normalizeZoomKeyframes(
  raw: ZoomKeyframe[] | undefined
): ZoomKeyframe[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new Error("zoomKeyframes must be an array");
  }
  if (raw.length === 0) return null;
  const pts: ZoomKeyframe[] = [];
  for (const k of raw) {
    if (
      !k ||
      typeof k.time !== "number" ||
      typeof k.scale !== "number" ||
      typeof k.x !== "number" ||
      typeof k.y !== "number"
    ) {
      throw new Error(
        "zoomKeyframes entries must be { time, scale, x, y } numbers"
      );
    }
    if (!(k.scale > 0)) {
      throw new Error("zoomKeyframes scale must be > 0");
    }
    pts.push({ time: k.time, scale: k.scale, x: k.x, y: k.y });
  }
  pts.sort((a, b) => a.time - b.time);
  return pts;
}

/** Normalize + validate speed ramp. Returns null if absent/empty. */
export function normalizeSpeedRamp(
  raw: SpeedRampPoint[] | undefined
): SpeedRampPoint[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new Error("speedRamp must be an array");
  }
  if (raw.length === 0) return null;
  const pts: SpeedRampPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p.time !== "number" || typeof p.speed !== "number") {
      throw new Error("speedRamp entries must be { time, speed } numbers");
    }
    if (!(p.speed > 0)) {
      throw new Error("speedRamp speed must be > 0");
    }
    pts.push({ time: p.time, speed: p.speed });
  }
  pts.sort((a, b) => a.time - b.time);
  return pts;
}

/**
 * Piecewise-constant speed: speed of last keyframe with time <= t.
 * Ensures coverage from t=0 using the first keyframe's speed if needed.
 */
export function effectiveSpeedRamp(
  ramp: SpeedRampPoint[]
): SpeedRampPoint[] {
  if (ramp.length === 0) return ramp;
  if (ramp[0].time > 0) {
    return [{ time: 0, speed: ramp[0].speed }, ...ramp];
  }
  return ramp;
}

/**
 * Map input (source) time → output time under a piecewise-constant speed ramp.
 */
export function mapInputTimeThroughSpeedRamp(
  t: number,
  ramp: SpeedRampPoint[]
): number {
  const pts = effectiveSpeedRamp(ramp);
  if (pts.length === 0) return t;
  let outAcc = 0;
  for (let i = 0; i < pts.length; i++) {
    const t0 = pts[i].time;
    const speed = pts[i].speed;
    const t1 = i + 1 < pts.length ? pts[i + 1].time : null;
    if (t <= t0) return outAcc;
    if (t1 == null) {
      return outAcc + (t - t0) / speed;
    }
    if (t < t1) {
      return outAcc + (t - t0) / speed;
    }
    outAcc += (t1 - t0) / speed;
  }
  return outAcc;
}

/** Build ffmpeg setpts expression: output PTS = map(T_seconds) / TB */
export function buildSpeedRampSetptsExpr(ramp: SpeedRampPoint[]): string {
  const pts = effectiveSpeedRamp(ramp);
  // Build nested: map T (seconds) → output seconds, then convert to PTS via /TB.
  // (Uniform path uses setpts=PTS/speed; output PTS must be in timebase units.
  //  Using *TB here collapsed every frame near PTS≈0 → ~2 video frames / tiny file.)
  function segmentExpr(i: number, outBefore: string): string {
    const t0 = pts[i].time;
    const speed = pts[i].speed;
    const t0s = Number(t0.toFixed(6));
    const ss = Number(speed.toFixed(6));
    if (i + 1 >= pts.length) {
      // last: outBefore + (T - t0) / speed
      return `(${outBefore})+(T-${t0s})/${ss}`;
    }
    const t1 = pts[i + 1].time;
    const t1s = Number(t1.toFixed(6));
    const full = `(${outBefore})+(${t1s}-${t0s})/${ss}`;
    const partial = `(${outBefore})+(T-${t0s})/${ss}`;
    const next = segmentExpr(i + 1, full);
    return `if(lt(T\\,${t1s})\\,${partial}\\,${next})`;
  }
  const mapExpr = segmentExpr(0, "0");
  return `setpts='(${mapExpr})/TB'`;
}

/**
 * Linear-interpolated zoom/crop chain for layout-resolution frames.
 * Applied before setpts so `t` is still clip-relative source time.
 */
export function buildZoomFilterExpr(
  keyframes: ZoomKeyframe[],
  outW: number,
  outH: number
): string {
  const pts = [...keyframes].sort((a, b) => a.time - b.time);

  function lerpProp(
    prop: "scale" | "x" | "y"
  ): string {
    // Hold first before first keyframe, hold last after last, lerp between
    if (pts.length === 1) {
      return String(Number(pts[0][prop].toFixed(6)));
    }
    // Build from the right
    let expr = String(Number(pts[pts.length - 1][prop].toFixed(6)));
    for (let i = pts.length - 2; i >= 0; i--) {
      const a = pts[i];
      const b = pts[i + 1];
      const t0 = Number(a.time.toFixed(6));
      const t1 = Number(b.time.toFixed(6));
      const v0 = Number(a[prop].toFixed(6));
      const v1 = Number(b[prop].toFixed(6));
      const dt = t1 - t0;
      const lerp =
        dt === 0
          ? String(v0)
          : `${v0}+(${v1}-${v0})*(t-${t0})/${Number(dt.toFixed(6))}`;
      // if t < t1: if t < t0 then v0 else lerp; else keep expr (later segment)
      // Actually iterating backward: for interval [t0,t1), use lerp; if t < t0 use v0 (or earlier)
      expr = `if(lt(t\\,${t0})\\,${v0}\\,if(lt(t\\,${t1})\\,${lerp}\\,${expr}))`;
    }
    // Before first keyframe: hold first value (already handled by lt(t,t0)->v0 when i=0)
    return expr;
  }

  const zExpr = lerpProp("scale");
  const xExpr = lerpProp("x");
  const yExpr = lerpProp("y");

  // Crop a zoomed window then scale back to outW×outH.
  // Z>=1: crop iw/Z × ih/Z centered at (x%, y%) of the frame.
  // Note: deep nested keyframe ifs with non-monotonic Z can make ffmpeg's
  // crop stick at identity. Wasted uses buildWastedCameraFilterExpr instead.
  const cropW = `iw/(${zExpr})`;
  const cropH = `ih/(${zExpr})`;
  const cropX = `iw*(${xExpr})/100-(${cropW})/2`;
  const cropY = `ih*(${yExpr})/100-(${cropH})/2`;

  return `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${outW}:${outH}`;
}

/**
 * Wasted camera: real zoom-OUT + real roll (frame rotation), no pan.
 *
 * Zoom OUT = visible source area INCREASES over time. Implemented as scale-up
 * factor S decreasing from startS→1.0, then center-crop to the output size:
 *   visibleSourceWidth = outW / S   (grows as S falls).
 * This is the opposite of raising a crop-Z above 1 without the inverse mapping.
 *
 * Roll = ffmpeg `rotate` (Z-axis tilt), cycle: 0 → −A → 0 → +A → 0, ending
 * at 0 exactly when S reaches endS. Angle is a few degrees (not ~45°); "45°"
 * in the product description was intensity metaphor, not a literal rotate value.
 *
 * Overscan: S(t) stays above the AABB growth of rotate(A) so black fill never
 * enters the final crop. No pad-based letterboxing.
 */
export type WastedCameraParams = {
  duration: number;
  /** Scale-up at t=0 (>1 ⇒ tighter FOV). */
  startS: number;
  /** Scale-up at t=duration (1.0 ⇒ full frame). */
  endS: number;
  /** Peak |roll| in degrees (left negative, right positive). */
  maxAngleDeg: number;
};

/** AABB growth factor for a rectangle rotated by `deg` degrees. */
export function rotationOverscan(deg: number): number {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return Math.abs(Math.cos(r)) + Math.abs(Math.sin(r));
}

export function resolveWastedCameraParams(
  duration: number,
  intensityPercent: number
): WastedCameraParams {
  const f = Math.max(0, Math.min(200, intensityPercent)) / 100;
  const d = Math.max(0.2, duration);
  // Peak roll @100% = 2.5° (cap 3.5°). Small enough to hide with moderate overscan.
  const maxAngleDeg = Number(clampNum(2.5 * f, 0, 3.5).toFixed(3));
  const endS = 1.0;
  // Original first-test magnitude reference: ~0.93 display → ~7% pull-back floor.
  const recipeStart = 1 / clampNum(1 - 0.07 * f, 0.85, 1);
  // Right-peak at 0.55·d must still cover rotate AABB (safety 1.12).
  const need = rotationOverscan(maxAngleDeg) * 1.12;
  const startFromAngle =
    maxAngleDeg < 0.05 ? recipeStart : (need - endS * (1 - 0.55)) / 0.55;
  const startS = Number(Math.max(recipeStart, startFromAngle).toFixed(4));
  return { duration: d, startS, endS, maxAngleDeg };
}

/**
 * Piecewise roll (degrees): 0 → −A @0.22d → 0 @0.40d → +A @0.55d → 0 @d.
 * Ends at 0 with the zoom-out.
 */
function wastedRollAngleExpr(duration: number, maxAngleDeg: number): string {
  const d = duration;
  const A = maxAngleDeg;
  const t1 = d * 0.22;
  const t2 = d * 0.4;
  const t3 = d * 0.55;
  return (
    `if(lt(t\\,${fmt(t1)})\\,${fmt(-A)}*t/${fmt(t1)}\\,` +
    `if(lt(t\\,${fmt(t2)})\\,${fmt(-A)}+${fmt(A)}*(t-${fmt(t1)})/${fmt(t2 - t1)}\\,` +
    `if(lt(t\\,${fmt(t3)})\\,${fmt(A)}*(t-${fmt(t2)})/${fmt(t3 - t2)}\\,` +
    `${fmt(A)}*(1-(t-${fmt(t3)})/${fmt(d - t3)}))))`
  );
}

/**
 * scale(S↓) → rotate(roll) → center crop. Zoom-out + roll, no pan, no borders.
 */
export function buildWastedCameraFilterExpr(
  duration: number,
  intensityPercent: number,
  outW: number,
  outH: number
): string {
  const { startS, endS, maxAngleDeg, duration: d } =
    resolveWastedCameraParams(duration, intensityPercent);
  const sExpr = `${fmt(startS)}+(${fmt(endS)}-${fmt(startS)})*min(t\\,${fmt(d)})/${fmt(d)}`;
  const aExpr = wastedRollAngleExpr(d, maxAngleDeg);
  return [
    `scale=w='max(2\\,trunc(iw*(${sExpr})/2)*2)':h='max(2\\,trunc(ih*(${sExpr})/2)*2)':eval=frame`,
    `rotate=a='(${aExpr})*PI/180':ow=iw:oh=ih:c=black`,
    `crop=${outW}:${outH}:(iw-${outW})/2:(ih-${outH})/2`,
  ].join(",");
}

/**
 * Optional hook range in preview-relative seconds.
 * Both omitted → null. One without the other → error.
 */
export function normalizeOptionalHook(
  hookStart: number | undefined,
  hookEnd: number | undefined,
  previewDuration: number
): { start: number; end: number } | null {
  const hasStart = hookStart != null;
  const hasEnd = hookEnd != null;
  if (!hasStart && !hasEnd) return null;
  if (!hasStart || !hasEnd) {
    throw new Error(
      "hookStart and hookEnd must both be provided or both omitted"
    );
  }
  if (typeof hookStart !== "number" || typeof hookEnd !== "number") {
    throw new Error("hookStart and hookEnd must be numbers");
  }
  if (!(hookEnd > hookStart)) {
    throw new Error("hookEnd must be greater than hookStart");
  }
  if (!(previewDuration > 0)) {
    throw new Error("preview duration must be > 0 to use a hook");
  }
  // Small eps for float / ffprobe rounding
  const eps = 0.05;
  if (hookStart < -eps || hookEnd > previewDuration + eps) {
    throw new Error(
      `hook range must fall within preview [0, ${Number(previewDuration.toFixed(3))}] (got ${hookStart}–${hookEnd})`
    );
  }
  const start = Math.max(0, hookStart);
  const end = Math.min(hookEnd, previewDuration);
  if (!(end > start)) {
    throw new Error("hookEnd must be greater than hookStart within preview");
  }
  return { start, end };
}

function buildAutoHookZoomKeyframes(duration: number): ZoomKeyframe[] {
  return [
    {
      time: 0,
      scale: HOOK_ZOOM_SCALE_START,
      x: HOOK_ZOOM_X,
      y: HOOK_ZOOM_Y,
    },
    {
      time: Math.max(duration, 0.001),
      scale: HOOK_ZOOM_SCALE_END,
      x: HOOK_ZOOM_X,
      y: HOOK_ZOOM_Y,
    },
  ];
}

async function concatDemuxerCopy(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const escapeConcatPath = (p: string) =>
    p.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const listBody =
    inputPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
  await fs.writeFile(listPath, listBody, "utf-8");
  try {
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }
}

/**
 * Pre-intro payoff from the same candidate preview:
 * dry cut, auto zoom via buildZoomFilterExpr, optional color, never subtitles.
 */
async function renderHookSegment(opts: {
  previewPath: string;
  hookStart: number;
  hookEnd: number;
  layoutFilter: string;
  split: boolean;
  outW: number;
  outH: number;
  zoomW: number;
  zoomH: number;
  colorPreset: ColorPresetId;
  resolutionScale: number;
  crf: number;
  x264Preset: string;
  audioBitrate: string;
  outputPath: string;
}): Promise<void> {
  const duration = opts.hookEnd - opts.hookStart;
  const zoomExpr = buildZoomFilterExpr(
    buildAutoHookZoomKeyframes(duration),
    opts.zoomW,
    opts.zoomH
  );
  const postParts: string[] = [zoomExpr];
  const colorFilter = colorPresetFilterExpr(opts.colorPreset, 100);
  if (colorFilter) {
    postParts.push(colorFilter);
  }
  if (opts.resolutionScale !== 1) {
    postParts.push(`scale=${opts.outW}:${opts.outH}`);
  }
  const postLayout = postParts.join(",");

  const args: string[] = [
    "-ss",
    String(Number(opts.hookStart.toFixed(6))),
    "-i",
    opts.previewPath,
    "-t",
    String(Number(duration.toFixed(6))),
  ];

  if (opts.split) {
    let videoChain = opts.layoutFilter;
    videoChain += `;[vout]${postLayout}[vfinal]`;
    args.push(
      "-filter_complex",
      videoChain,
      "-map",
      "[vfinal]",
      "-map",
      "0:a?"
    );
  } else {
    const vf = [opts.layoutFilter, postLayout].join(",");
    args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
  }

  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(opts.crf),
    "-preset",
    opts.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    opts.audioBitrate,
    "-movflags",
    "+faststart",
    opts.outputPath
  );

  await runFfmpeg(args);
}

type SpeedInterval = { start: number; end: number; speed: number };

function speedRampIntervals(
  ramp: SpeedRampPoint[],
  clipDuration: number
): SpeedInterval[] {
  const pts = effectiveSpeedRamp(ramp);
  const intervals: SpeedInterval[] = [];
  for (let i = 0; i < pts.length; i++) {
    const start = pts[i].time;
    const end =
      i + 1 < pts.length ? pts[i + 1].time : Math.max(clipDuration, start + 0.001);
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
  if (intervals.length === 0) {
    return "";
  }
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

/**
 * Second-pass: apply library video overlays + music/sfx onto an already-rendered
 * file (e.g. wasted-insert concat). clipTimestamp is absolute on THIS file's
 * timeline (final timeline, including any duration inserted by Wasted).
 * Does not alter Wasted camera/color/timing — only composites library effects.
 */
export async function applyLibraryEffectsOntoFile(opts: {
  inputPath: string;
  outputPath: string;
  effects: ReturnType<typeof loadEffectsForExport>;
  frameW: number;
  frameH: number;
  crf: number;
  x264Preset: string;
  audioBitrate: string;
  videoEncoder?: PreviewVideoEncoder;
}): Promise<void> {
  const { effects } = opts;
  if (effects.length === 0) {
    await fs.copyFile(opts.inputPath, opts.outputPath);
    return;
  }

  const args: string[] = ["-i", opts.inputPath];
  const inputIndexes = appendEffectInputs(args, effects);
  const filterParts: string[] = [];

  if (hasVideoEffects(effects)) {
    filterParts.push(`[0:v]null[vbase]`);
    filterParts.push(
      buildVideoOverlayFilters(
        effects,
        inputIndexes,
        opts.frameW,
        opts.frameH,
        "vbase",
        "vfinal"
      )
    );
  }

  const audioParts: string[] = [];
  let mapAudio = "0:a?";
  const prepare = buildMainAudioPrepare(effects, null);
  if (hasAudioEffects(effects)) {
    if (prepare) {
      audioParts.push(prepare);
      const mix = buildAudioFxMixOntoLabel(effects, inputIndexes, "amain");
      if (mix) audioParts.push(mix);
    } else {
      const mix = buildAudioFxMixOntoLabel(effects, inputIndexes, "0:a");
      if (mix) audioParts.push(mix);
    }
    mapAudio = "[aout]";
  } else if (prepare) {
    audioParts.push(prepare.replace(/\[amain\]/g, "[aout]"));
    mapAudio = "[aout]";
  }

  const allFilters = [...filterParts, ...audioParts];
  const mapVideo = hasVideoEffects(effects) ? "[vfinal]" : "0:v";

  if (allFilters.length > 0) {
    args.push(
      "-filter_complex",
      allFilters.join(";"),
      "-map",
      mapVideo,
      "-map",
      mapAudio
    );
  } else {
    args.push("-map", "0:v", "-map", "0:a?");
  }

  appendVideoEncoderArgs(args, {
    encoder: opts.videoEncoder ?? "libx264",
    crf: opts.crf,
    x264Preset: opts.x264Preset,
    audioBitrate: opts.audioBitrate,
    outputPath: opts.outputPath,
  });
  await runFfmpeg(args);
}

/**
 * Export one marked candidate from previews/{id}.mp4 with layout, optional
 * speed/subtitles, and quality CRF preset → prontos/{runId}/{id}_final.mp4
 *
 * Sprint J optional additives: zoomKeyframes, speedRamp, colorPreset.
 * Optional hookStart/hookEnd: pre-intro payoff from the same preview
 * (auto zoom 1.0→1.12, no subtitles, colorPreset if set) then concat + main.
 * When hook absent, behavior matches the previous /export path.
 */

function sortPresetApplications(
  apps: PresetApplicationPayload[]
): PresetApplicationPayload[] {
  return [...apps].sort((a, b) => a.effectStart - b.effectStart);
}

function mergeInPlacePresetApplications(
  apps: PresetApplicationPayload[]
): {
  zoomKeyframes: ZoomKeyframe[] | null;
  speedRamp: SpeedRampPoint[] | null;
  colorFilters: string[];
} {
  const allZoom: ZoomKeyframe[] = [];
  const allSpeed: SpeedRampPoint[] = [];
  const colorFilters: string[] = [];

  for (const app of sortPresetApplications(apps)) {
    const zk = normalizeZoomKeyframes(app.zoomKeyframes);
    if (zk) {
      allZoom.push(...zk);
      // Zoom expr holds last keyframe forever — reset to identity after each window
      // so later presets do not inherit punch-in from earlier ones.
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
  };
}

/** Apply zoom/color/speed onto an already-layout-rendered file (no layout pass). */
async function applyInPlaceEffectsOntoFile(opts: {
  inputPath: string;
  outputPath: string;
  zoomKeyframes?: ZoomKeyframe[] | null;
  speedRamp?: SpeedRampPoint[] | null;
  speed?: number;
  colorFilters?: string[];
  clipDuration: number;
  outW: number;
  outH: number;
  crf: number;
  x264Preset: string;
  audioBitrate: string;
}): Promise<void> {
  const zoomKeyframes = normalizeZoomKeyframes(opts.zoomKeyframes ?? undefined);
  const speedRamp = normalizeSpeedRamp(opts.speedRamp ?? undefined);
  const speed = speedRamp ? 1 : (opts.speed ?? 1);
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const vfParts: string[] = [];
  if (zoomKeyframes) {
    vfParts.push(buildZoomFilterExpr(zoomKeyframes, opts.outW, opts.outH));
  }
  for (const cf of opts.colorFilters ?? []) {
    vfParts.push(cf);
  }
  if (rampActive && speedRamp) {
    vfParts.push(buildSpeedRampSetptsExpr(speedRamp));
  } else if (speedChanged) {
    vfParts.push(`setpts=PTS/${Number(speed.toFixed(6))}`);
  }

  const rampAudio =
    rampActive && speedRamp
      ? buildRampAudioFilter(speedRamp, opts.clipDuration)
      : "";

  const args: string[] = ["-i", opts.inputPath];
  if (vfParts.length === 0 && !rampAudio) {
    await fs.copyFile(opts.inputPath, opts.outputPath);
    return;
  }

  if (rampAudio) {
    if (vfParts.length > 0) {
      args.push(
        "-filter_complex",
        `[0:v]${vfParts.join(",")}[vfinal];${rampAudio}`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-filter_complex", rampAudio, "-map", "0:v", "-map", "[aout]");
    }
  } else if (vfParts.length > 0) {
    args.push("-vf", vfParts.join(","), "-map", "0:v", "-map", "0:a?");
  } else {
    args.push("-map", "0:v", "-map", "0:a?");
  }

  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(opts.crf),
    "-preset",
    opts.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    opts.audioBitrate,
    "-movflags",
    "+faststart",
    opts.outputPath
  );
  await runFfmpeg(args);
}

type MultiPresetExportContext = {
  t0: number;
  candidate: ClipEditable;
  vodId: string;
  vodDir: string;
  previewPath: string;
  clipDuration: number;
  previewShorterThanMarked: boolean;
  /** Seconds into preview file when exporting a sub-range of material. */
  previewOffsetSec: number;
  exportDir: string;
  localFinalPath: string;
  workAssPath: string;
  layout: NonNullable<ReturnType<typeof getLayoutPreset>>;
  nativeW: number;
  nativeH: number;
  outW: number;
  outH: number;
  zoomW: number;
  zoomH: number;
  quality: ReturnType<typeof getQualityPreset> & {};
  hookRange: { start: number; end: number } | null;
};

async function exportMultiPresetApplications(
  candidateId: string,
  input: ExportCandidateInput,
  ctx: MultiPresetExportContext
): Promise<ExportCandidateResult> {
  const apps = sortPresetApplications(input.presetApplications ?? []);
  const hasWasted = apps.some((a) => a.presetId === "wasted");

  if (!hasWasted) {
    const merged = mergeInPlacePresetApplications(apps);
    const mergedInput: ExportCandidateInput = {
      ...input,
      presetApplications: undefined,
      zoomKeyframes: merged.zoomKeyframes ?? undefined,
      speedRamp: merged.speedRamp ?? undefined,
      colorPreset: "none",
      colorEffectStart: undefined,
      colorEffectEnd: undefined,
      colorFadeSeconds: undefined,
    };
    return exportCandidateWithExtraColorFilters(
      candidateId,
      mergedInput,
      ctx,
      merged.colorFilters
    );
  }

  const workDir = path.join(ctx.exportDir, `.multi_${candidateId}`);
  await fs.mkdir(workDir, { recursive: true });
  let currentPath = ctx.previewPath;
  let currentDuration = ctx.clipDuration;

  const inPlaceBefore: PresetApplicationPayload[] = [];
  const wastedApps: PresetApplicationPayload[] = [];
  const inPlaceAfter: PresetApplicationPayload[] = [];
  let seenWasted = false;
  for (const app of apps) {
    if (app.presetId === "wasted") {
      seenWasted = true;
      wastedApps.push(app);
    } else if (!seenWasted) {
      inPlaceBefore.push(app);
    } else {
      inPlaceAfter.push(app);
    }
  }

  let step = 0;
  const nextPath = () => path.join(workDir, `step_${step++}.mp4`);

  if (inPlaceBefore.length > 0) {
    const merged = mergeInPlacePresetApplications(inPlaceBefore);
    const stepPath = nextPath();
    await renderBaseLayoutClip({
      previewPath: currentPath,
      clipDuration: currentDuration,
      input,
      ctx,
      outputPath: stepPath,
      zoomKeyframes: merged.zoomKeyframes,
      speedRamp: merged.speedRamp,
      extraColorFilters: merged.colorFilters,
    });
    currentPath = stepPath;
  }

  for (const app of wastedApps) {
    const stepPath = nextPath();
    const effectDuration =
      app.effectDuration ??
      Math.max(0.5, app.effectEnd - app.effectStart);
    await renderWastedInsertClip({
      previewPath: currentPath,
      clipDuration: currentDuration,
      insertAtTime: app.effectStart,
      effectDuration,
      intensityPercent: app.intensityPercent,
      layoutPresetId: input.preset,
      quality: input.quality,
      outputPath: stepPath,
      workDir: path.join(workDir, `wasted_${step}`),
      skipLayout: currentPath !== ctx.previewPath,
    });
    currentPath = stepPath;
  }

  if (inPlaceAfter.length > 0) {
    const merged = mergeInPlacePresetApplications(inPlaceAfter);
    const stepPath = nextPath();
    await applyInPlaceEffectsOntoFile({
      inputPath: currentPath,
      outputPath: stepPath,
      zoomKeyframes: merged.zoomKeyframes,
      speedRamp: merged.speedRamp,
      speed: input.speed,
      colorFilters: merged.colorFilters,
      clipDuration: currentDuration,
      outW: ctx.outW,
      outH: ctx.outH,
      crf: ctx.quality.crf,
      x264Preset: ctx.quality.x264Preset,
      audioBitrate: ctx.quality.audioBitrate,
    });
    currentPath = stepPath;
  }

  await finalizeExportFromProcessedClip(candidateId, input, ctx, currentPath);
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

  const candidate = { ...(await findClipEditableById(candidateId)) };
  const { runId } = await getCurrentRun(ctx.vodId);
  const runDir = path.join(ctx.vodDir, "prontos", runId);
  const fileName = `${candidateId}_final.mp4`;
  const prontosPath = path.join(runDir, fileName);
  const prontosRelativePath = `prontos/${runId}/${fileName}`;

  return {
    candidate,
    prontosPath,
    prontosRelativePath,
    runId,
    elapsedMs: Date.now() - ctx.t0,
    previewShorterThanMarked: ctx.previewShorterThanMarked || undefined,
  };
}

async function renderBaseLayoutClip(opts: {
  previewPath: string;
  clipDuration: number;
  input: ExportCandidateInput;
  ctx: MultiPresetExportContext;
  outputPath: string;
  zoomKeyframes: ZoomKeyframe[] | null;
  speedRamp: SpeedRampPoint[] | null;
  extraColorFilters: string[];
}): Promise<void> {
  const speedRamp = opts.speedRamp;
  const speed = speedRamp ? 1 : opts.input.speed;
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const layoutFilter = buildFilterComplex(opts.ctx.layout);
  if (!layoutFilter) {
    throw new Error(`Could not build layout filter for preset ${opts.input.preset}`);
  }

  const postLayoutCoreParts: string[] = [];
  if (opts.zoomKeyframes) {
    postLayoutCoreParts.push(
      buildZoomFilterExpr(opts.zoomKeyframes, opts.ctx.zoomW, opts.ctx.zoomH)
    );
  }
  postLayoutCoreParts.push(...opts.extraColorFilters);
  if (rampActive && speedRamp) {
    postLayoutCoreParts.push(buildSpeedRampSetptsExpr(speedRamp));
  } else if (speedChanged) {
    postLayoutCoreParts.push(`setpts=PTS/${Number(speed.toFixed(6))}`);
  }
  if (opts.ctx.quality.resolutionScale !== 1) {
    postLayoutCoreParts.push(`scale=${opts.ctx.outW}:${opts.ctx.outH}`);
  }
  const postLayoutCore = postLayoutCoreParts.join(",");

  const rampAudio =
    rampActive && speedRamp
      ? buildRampAudioFilter(speedRamp, opts.clipDuration)
      : "";

  const args: string[] = [];
  pushCappedPreviewInput(
    args,
    opts.previewPath,
    opts.clipDuration,
    opts.ctx.previewOffsetSec
  );
  if (opts.ctx.layout.split) {
    let videoChain = layoutFilter;
    if (postLayoutCore) {
      videoChain += `;[vout]${postLayoutCore}[vfinal]`;
    }
    const vMap = postLayoutCore ? "[vfinal]" : "[vout]";
    if (rampAudio) {
      videoChain += `;${rampAudio}`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      videoChain += `;[0:a]${atempo}[aout]`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else {
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "0:a?");
    }
  } else {
    const vfParts = [layoutFilter];
    if (postLayoutCore) vfParts.push(postLayoutCore);
    const vf = vfParts.join(",");
    if (rampAudio) {
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];${rampAudio}`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];[0:a]${atempo}[aout]`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
    }
  }

  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(opts.ctx.quality.crf),
    "-preset",
    opts.ctx.quality.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    opts.ctx.quality.audioBitrate,
    "-movflags",
    "+faststart",
    opts.outputPath
  );
  await runFfmpeg(args);
}

async function finalizeExportFromProcessedClip(
  candidateId: string,
  input: ExportCandidateInput,
  ctx: MultiPresetExportContext,
  processedPath: string
): Promise<void> {
  const libraryEffects = loadEffectsForExport(candidateId);
  let currentPath = processedPath;

  if (libraryEffects.length > 0) {
    const withFxPath = path.join(ctx.exportDir, `${candidateId}_final_libfx.mp4`);
    await applyLibraryEffectsOntoFile({
      inputPath: currentPath,
      outputPath: withFxPath,
      effects: libraryEffects,
      frameW: ctx.outW,
      frameH: ctx.outH,
      crf: ctx.quality.crf,
      x264Preset: ctx.quality.x264Preset,
      audioBitrate: ctx.quality.audioBitrate,
    });
    currentPath = withFxPath;
  }

  if (input.useSubtitles) {
    const transcriptPath = path.join(
      ctx.vodDir,
      ctx.candidate.clipTranscriptRelativePath ??
        `transcripts/${candidateId}.json`
    );
    try {
      await fs.access(transcriptPath);
    } catch {
      throw new Error(
        `Clip transcript not found for candidate ${candidateId}. Run transcribe-clip first.`
      );
    }
    const rangeStart = input.subtitleRange?.start ?? 0;
    const rangeEnd = input.subtitleRange?.end ?? 1e9;
    await writeClipCaptions({
      transcriptPath,
      clipStart: rangeStart,
      clipEnd: rangeEnd,
      layoutPresetId: input.preset,
      outputAssPath: ctx.workAssPath,
      playResOverride: { w: ctx.outW, h: ctx.outH },
      keepAbsoluteTimes: true,
    });
    const fontsDir = getCaptionFontsDir();
    const escapedAss = ctx.workAssPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedFonts = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
    const subtitledPath = path.join(ctx.exportDir, `${candidateId}_subtitled.mp4`);
    await runFfmpeg([
      "-i",
      currentPath,
      "-vf",
      `subtitles='${escapedAss}':fontsdir='${escapedFonts}'`,
      "-c:v",
      "libx264",
      "-crf",
      String(ctx.quality.crf),
      "-preset",
      ctx.quality.x264Preset,
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      subtitledPath,
    ]);
    currentPath = subtitledPath;
  }

  if (ctx.hookRange) {
    const hookPath = path.join(ctx.exportDir, `${candidateId}_hook.mp4`);
    const layoutFilter = buildFilterComplex(ctx.layout);
    if (!layoutFilter) {
      throw new Error(`Could not build layout filter for preset ${input.preset}`);
    }
    await renderHookSegment({
      previewPath: ctx.previewPath,
      hookStart: ctx.hookRange.start,
      hookEnd: ctx.hookRange.end,
      layoutFilter,
      split: Boolean(ctx.layout.split),
      outW: ctx.outW,
      outH: ctx.outH,
      zoomW: ctx.zoomW,
      zoomH: ctx.zoomH,
      colorPreset: "none",
      resolutionScale: ctx.quality.resolutionScale,
      crf: ctx.quality.crf,
      x264Preset: ctx.quality.x264Preset,
      audioBitrate: ctx.quality.audioBitrate,
      outputPath: hookPath,
    });
    await concatDemuxerCopy([hookPath, currentPath], ctx.localFinalPath);
    await fs.unlink(hookPath).catch(() => undefined);
  } else {
    await fs.copyFile(currentPath, ctx.localFinalPath);
  }

  const { runId } = await getCurrentRun(ctx.vodId);
  const runDir = path.join(ctx.vodDir, "prontos", runId);
  await fs.mkdir(runDir, { recursive: true });
  const fileName = `${candidateId}_final.mp4`;
  const prontosPath = path.join(runDir, fileName);
  await fs.copyFile(ctx.localFinalPath, prontosPath);

  const candidate = { ...(await findClipEditableById(candidateId)) };
  candidate.status = "exported";
  candidate.exportRelativePath = `prontos/${runId}/${fileName}`;
  await saveClipEditable(candidate);
}

async function exportCandidateWithExtraColorFilters(
  candidateId: string,
  input: ExportCandidateInput,
  ctx: MultiPresetExportContext,
  extraColorFilters: string[]
): Promise<ExportCandidateResult> {
  const zoomKeyframes = normalizeZoomKeyframes(input.zoomKeyframes);
  const speedRamp = normalizeSpeedRamp(input.speedRamp);
  const speed = speedRamp ? 1 : input.speed;
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const layoutFilter = buildFilterComplex(ctx.layout);
  if (!layoutFilter) {
    throw new Error(`Could not build layout filter for preset ${input.preset}`);
  }

  let assForBurn: string | null = null;
  if (input.useSubtitles) {
    const transcriptPath = path.join(
      ctx.vodDir,
      ctx.candidate.clipTranscriptRelativePath ??
        `transcripts/${candidateId}.json`
    );
    try {
      await fs.access(transcriptPath);
    } catch {
      throw new Error(
        `Clip transcript not found for candidate ${candidateId}. Run transcribe-clip first.`
      );
    }
    const rangeStart = input.subtitleRange?.start ?? 0;
    const rangeEnd = input.subtitleRange?.end ?? 1e9;
    const captionOpts: Parameters<typeof writeClipCaptions>[0] = {
      transcriptPath,
      clipStart: rangeStart,
      clipEnd: rangeEnd,
      layoutPresetId: input.preset,
      outputAssPath: ctx.workAssPath,
      playResOverride: { w: ctx.outW, h: ctx.outH },
      keepAbsoluteTimes: true,
    };
    if (rampActive && speedRamp) {
      captionOpts.remapTime = (t) => mapInputTimeThroughSpeedRamp(t, speedRamp);
    } else if (speedChanged) {
      captionOpts.timeScale = 1 / speed;
    }
    await writeClipCaptions(captionOpts);
    assForBurn = ctx.workAssPath;
  }

  const postLayoutCoreParts: string[] = [];
  if (zoomKeyframes) {
    postLayoutCoreParts.push(
      buildZoomFilterExpr(zoomKeyframes, ctx.zoomW, ctx.zoomH)
    );
  }
  postLayoutCoreParts.push(...extraColorFilters);
  if (rampActive && speedRamp) {
    postLayoutCoreParts.push(buildSpeedRampSetptsExpr(speedRamp));
  } else if (speedChanged) {
    postLayoutCoreParts.push(`setpts=PTS/${Number(speed.toFixed(6))}`);
  }
  if (ctx.quality.resolutionScale !== 1) {
    postLayoutCoreParts.push(`scale=${ctx.outW}:${ctx.outH}`);
  }

  let subtitleFilter: string | null = null;
  if (assForBurn) {
    const fontsDir = getCaptionFontsDir();
    const escapedAss = assForBurn.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedFonts = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
    subtitleFilter = `subtitles='${escapedAss}':fontsdir='${escapedFonts}'`;
  }

  const postLayoutCore = postLayoutCoreParts.join(",");
  const postLayoutParts = [...postLayoutCoreParts];
  if (subtitleFilter) postLayoutParts.push(subtitleFilter);
  const postLayout = postLayoutParts.join(",");

  const rampAudio =
    rampActive && speedRamp
      ? buildRampAudioFilter(speedRamp, ctx.clipDuration)
      : "";

  const libraryEffects = loadEffectsForExport(candidateId);
  const hasLibraryEffects = libraryEffects.length > 0;
  const mainPath = ctx.hookRange
    ? path.join(ctx.exportDir, `${candidateId}_main.mp4`)
    : ctx.localFinalPath;

  const args: string[] = [];
  pushCappedPreviewInput(args, ctx.previewPath, ctx.clipDuration, ctx.previewOffsetSec);

  if (hasLibraryEffects) {
    const inputIndexes = appendEffectInputs(args, libraryEffects);
    const filterParts: string[] = [];
    if (ctx.layout.split) {
      filterParts.push(layoutFilter);
      if (postLayoutCore) {
        filterParts.push(`[vout]${postLayoutCore}[vcore]`);
      } else {
        filterParts.push(`[vout]null[vcore]`);
      }
    } else {
      const vfCore = [layoutFilter, postLayoutCore].filter(Boolean).join(",");
      filterParts.push(`[0:v]${vfCore}[vcore]`);
    }
    if (hasVideoEffects(libraryEffects)) {
      filterParts.push(
      buildVideoOverlayFilters(
        libraryEffects,
        inputIndexes,
        ctx.outW,
        ctx.outH,
        "vcore",
        "vovl",
        "",
        ctx.clipDuration
      )
      );
    } else {
      filterParts.push(`[vcore]null[vovl]`);
    }
    if (subtitleFilter) {
      filterParts.push(`[vovl]${subtitleFilter}[vfinal]`);
    } else {
      filterParts.push(`[vovl]null[vfinal]`);
    }
    const audioParts: string[] = [];
    let mapAudio = "0:a?";
    if (rampAudio) {
      audioParts.push(rampAudio.replace(/\[aout\]/g, "[aramp]"));
      const mix = buildAudioFxMixOntoLabel(
        libraryEffects,
        inputIndexes,
        "aramp"
      );
      if (mix) audioParts.push(mix);
      mapAudio = "[aout]";
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      const prepare = buildMainAudioPrepare(libraryEffects, atempo);
      if (hasAudioEffects(libraryEffects)) {
        if (prepare) audioParts.push(prepare);
        const mix = buildAudioFxMixOntoLabel(
          libraryEffects,
          inputIndexes,
          "amain"
        );
        if (mix) audioParts.push(mix);
        mapAudio = "[aout]";
      } else if (prepare) {
        audioParts.push(prepare.replace(/\[amain\]/g, "[aout]"));
        mapAudio = "[aout]";
      } else {
        audioParts.push(`[0:a]${atempo}[aout]`);
        mapAudio = "[aout]";
      }
    } else {
      const prepare = buildMainAudioPrepare(libraryEffects, null);
      if (hasAudioEffects(libraryEffects)) {
        if (prepare) audioParts.push(prepare);
        const mix = buildAudioFxMixOntoLabel(
          libraryEffects,
          inputIndexes,
          "amain"
        );
        if (mix) audioParts.push(mix);
        mapAudio = "[aout]";
      } else if (prepare) {
        audioParts.push(prepare.replace(/\[amain\]/g, "[aout]"));
        mapAudio = "[aout]";
      }
    }
    let videoChain = filterParts.join(";");
    if (audioParts.length > 0) videoChain += `;${audioParts.join(";")}`;
    args.push("-filter_complex", videoChain, "-map", "[vfinal]", "-map", mapAudio);
  } else if (ctx.layout.split) {
    let videoChain = layoutFilter;
    if (postLayout) videoChain += `;[vout]${postLayout}[vfinal]`;
    const vMap = postLayout ? "[vfinal]" : "[vout]";
    if (rampAudio) {
      videoChain += `;${rampAudio}`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      videoChain += `;[0:a]${atempo}[aout]`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else {
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "0:a?");
    }
  } else {
    const vfParts = [layoutFilter];
    if (postLayout) vfParts.push(postLayout);
    const vf = vfParts.join(",");
    if (rampAudio) {
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];${rampAudio}`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];[0:a]${atempo}[aout]`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
    }
  }

  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(ctx.quality.crf),
    "-preset",
    ctx.quality.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    ctx.quality.audioBitrate,
    "-movflags",
    "+faststart",
    mainPath
  );
  await runFfmpeg(args);

  if (ctx.hookRange) {
    const hookPath = path.join(ctx.exportDir, `${candidateId}_hook.mp4`);
    await renderHookSegment({
      previewPath: ctx.previewPath,
      hookStart: ctx.hookRange.start,
      hookEnd: ctx.hookRange.end,
      layoutFilter,
      split: Boolean(ctx.layout.split),
      outW: ctx.outW,
      outH: ctx.outH,
      zoomW: ctx.zoomW,
      zoomH: ctx.zoomH,
      colorPreset: "none",
      resolutionScale: ctx.quality.resolutionScale,
      crf: ctx.quality.crf,
      x264Preset: ctx.quality.x264Preset,
      audioBitrate: ctx.quality.audioBitrate,
      outputPath: hookPath,
    });
    await concatDemuxerCopy([hookPath, mainPath], ctx.localFinalPath);
    await fs.unlink(hookPath).catch(() => undefined);
    await fs.unlink(mainPath).catch(() => undefined);
  }

  const { runId } = await getCurrentRun(ctx.vodId);
  const runDir = path.join(ctx.vodDir, "prontos", runId);
  await fs.mkdir(runDir, { recursive: true });
  const fileName = `${candidateId}_final.mp4`;
  const prontosPath = path.join(runDir, fileName);
  await fs.copyFile(ctx.localFinalPath, prontosPath);

  const candidate = { ...(await findClipEditableById(candidateId)) };
  candidate.status = "exported";
  candidate.exportRelativePath = `prontos/${runId}/${fileName}`;
  await saveClipEditable(candidate);

  return {
    candidate,
    prontosPath,
    prontosRelativePath: `prontos/${runId}/${fileName}`,
    runId,
    elapsedMs: Date.now() - ctx.t0,
    previewShorterThanMarked: ctx.previewShorterThanMarked || undefined,
  };
}

export async function exportCandidate(
  candidateId: string,
  input: ExportCandidateInput
): Promise<ExportCandidateResult> {
  const t0 = Date.now();
  const quality = getQualityPreset(input.quality);
  if (!quality) {
    throw new Error(`Invalid quality: ${input.quality}. Use draft | hd | max`);
  }

  let zoomKeyframes = normalizeZoomKeyframes(input.zoomKeyframes);
  let speedRamp = normalizeSpeedRamp(input.speedRamp);

  if (speedRamp) {
    // ramp replaces uniform speed — no further check on input.speed
  } else if (!(typeof input.speed === "number") || !(input.speed > 0)) {
    throw new Error("speed must be a number > 0");
  }

  if (typeof input.useSubtitles !== "boolean") {
    throw new Error("useSubtitles must be a boolean");
  }

  const colorPreset: ColorPresetId =
    input.colorPreset == null || input.colorPreset === "none"
      ? "none"
      : input.colorPreset;
  if (!isKnownColorPreset(colorPreset)) {
    throw new Error(
      'colorPreset must be "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale"'
    );
  }

  const layout = getLayoutPreset(input.preset);
  if (!layout) {
    throw new Error(
      `Unknown layout preset: ${input.preset}. Use one of the project layout ids (e.g. vertical-split-9x16, horizontal-16x9).`
    );
  }

  if (
    input.subtitleRange != null &&
    (typeof input.subtitleRange.start !== "number" ||
      typeof input.subtitleRange.end !== "number" ||
      !(input.subtitleRange.end > input.subtitleRange.start))
  ) {
    throw new Error(
      "subtitleRange must be null or { start, end } with end > start"
    );
  }

  let candidate = { ...(await findClipEditableById(candidateId)) };
  const vodId = candidate.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const { previewPath, editable: refreshed } = await ensurePreviewForInterval(
    candidateId,
    candidate.start,
    candidate.end
  );
  candidate = { ...refreshed };

  const nativeW = layout.outputResolution.w;
  const nativeH = layout.outputResolution.h;
  const outW = evenDim(nativeW * quality.resolutionScale);
  const outH = evenDim(nativeH * quality.resolutionScale);
  // Zoom crop runs at layout native res, then draft scale may shrink later
  const zoomW = nativeW;
  const zoomH = nativeH;

  const markedDuration = Math.max(0.1, candidate.end - candidate.start);
  const probedDuration = await resolveCachedPreviewDuration(
    previewPath,
    markedDuration
  );
  let { clipDuration, previewShorterThanMarked } = resolveMarkedClipDuration(
    markedDuration,
    probedDuration
  );
  if (previewShorterThanMarked) {
    console.warn(
      `[export] Preview shorter than marked interval for ${candidateId}: probed=${probedDuration?.toFixed(3)}s marked=${markedDuration.toFixed(3)}s — using ${clipDuration.toFixed(3)}s`
    );
  }

  const previewOffsetSec = Math.max(0, input.clipRange?.start ?? 0);
  const exportRangeEnd = Math.min(
    clipDuration,
    input.clipRange?.end ?? clipDuration
  );
  let exportClipDuration = Math.max(0.1, exportRangeEnd - previewOffsetSec);
  const hasClipWindow =
    previewOffsetSec > 0.001 || exportRangeEnd < clipDuration - 0.05;
  if (hasClipWindow) {
    clipDuration = exportClipDuration;
    zoomKeyframes = shiftZoomKeyframesForWindow(
      zoomKeyframes ?? [],
      previewOffsetSec,
      exportClipDuration
    );
    speedRamp = shiftSpeedRampForWindow(
      speedRamp,
      previewOffsetSec,
      exportClipDuration
    );
    if (
      typeof input.colorEffectStart === "number" &&
      typeof input.colorEffectEnd === "number"
    ) {
      const shiftedStart = Math.max(0, input.colorEffectStart - previewOffsetSec);
      const shiftedEnd = Math.max(0, input.colorEffectEnd - previewOffsetSec);
      if (shiftedEnd > shiftedStart) {
        input = {
          ...input,
          colorEffectStart: shiftedStart,
          colorEffectEnd: shiftedEnd,
        };
      } else {
        input = {
          ...input,
          colorEffectStart: undefined,
          colorEffectEnd: undefined,
        };
      }
    }
  }

  const speed = speedRamp ? 1 : input.speed;
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const hookRange = normalizeOptionalHook(
    input.hookStart,
    input.hookEnd,
    clipDuration
  );

  const exportDir = path.join(vodDir, "exports");
  await fs.mkdir(exportDir, { recursive: true });
  const localFinalPath = path.join(exportDir, `${candidateId}_final.mp4`);
  const workAssPath = path.join(exportDir, `${candidateId}_export.ass`);

  // Sprint 5: preset applications (sequential or merged in-place).
  if (input.presetApplications && input.presetApplications.length >= 1) {
    if (input.presetApplications.length === 1) {
      const merged = mergeInPlacePresetApplications(input.presetApplications);
      input = {
        ...input,
        presetApplications: undefined,
        zoomKeyframes: merged.zoomKeyframes ?? undefined,
        speedRamp: merged.speedRamp ?? undefined,
        colorPreset: "none",
        colorEffectStart: undefined,
        colorEffectEnd: undefined,
        colorFadeSeconds: undefined,
      };
      return exportCandidateWithExtraColorFilters(
        candidateId,
        input,
        {
          t0,
          candidate,
          vodId,
          vodDir,
          previewPath,
          clipDuration,
          previewShorterThanMarked,
          previewOffsetSec: hasClipWindow ? previewOffsetSec : 0,
          exportDir,
          localFinalPath,
          workAssPath,
          layout,
          nativeW,
          nativeH,
          outW,
          outH,
          zoomW,
          zoomH,
          quality,
          hookRange,
        },
        merged.colorFilters
      );
    }
    return exportMultiPresetApplications(candidateId, input, {
      t0,
      candidate,
      vodId,
      vodDir,
      previewPath,
      clipDuration,
      previewShorterThanMarked,
      previewOffsetSec: hasClipWindow ? previewOffsetSec : 0,
      exportDir,
      localFinalPath,
      workAssPath,
      layout,
      nativeW,
      nativeH,
      outW,
      outH,
      zoomW,
      zoomH,
      quality,
      hookRange,
    });
  }

  // Wasted in-place: concat before + graded window + after (same total duration).
  if (input.wastedInsert) {
    const w = input.wastedInsert;
    if (
      typeof w.insertAtTime !== "number" ||
      typeof w.effectDuration !== "number" ||
      !(w.effectDuration >= 0.5)
    ) {
      throw new Error(
        "wastedInsert requires insertAtTime and effectDuration (≥ 0.5)"
      );
    }
    await renderWastedInsertClip({
      previewPath,
      clipDuration,
      insertAtTime: w.insertAtTime,
      effectDuration: w.effectDuration,
      intensityPercent: w.intensityPercent ?? input.colorIntensityPercent ?? 100,
      layoutPresetId: input.preset,
      quality: input.quality,
      outputPath: localFinalPath,
      workDir: path.join(exportDir, `.wasted_${candidateId}`),
    });

    // Library effects (video/music/sfx) were previously skipped by this early
    // return. Second pass on the already-concatenated Wasted result — timestamps
    // are absolute on the FINAL timeline (including inserted effectDuration).
    // If clipTimestamp falls inside the Wasted insert window, the overlay/sfx
    // still lands at that absolute time (on top of the Wasted segment).
    const wastedLibraryEffects = loadEffectsForExport(candidateId);
    if (wastedLibraryEffects.length > 0) {
      const withFxPath = path.join(
        exportDir,
        `${candidateId}_final_libfx.mp4`
      );
      await applyLibraryEffectsOntoFile({
        inputPath: localFinalPath,
        outputPath: withFxPath,
        effects: wastedLibraryEffects,
        frameW: outW,
        frameH: outH,
        crf: quality.crf,
        x264Preset: quality.x264Preset,
        audioBitrate: quality.audioBitrate,
      });
      await fs.unlink(localFinalPath).catch(() => undefined);
      await fs.rename(withFxPath, localFinalPath);
    }

    const { runId } = await getCurrentRun(vodId);
    const runDir = path.join(vodDir, "prontos", runId);
    await fs.mkdir(runDir, { recursive: true });
    const fileName = `${candidateId}_final.mp4`;
    const prontosPath = path.join(runDir, fileName);
    await fs.copyFile(localFinalPath, prontosPath);
    const prontosRelativePath = `prontos/${runId}/${fileName}`;
    candidate.status = "exported";
    candidate.exportRelativePath = prontosRelativePath;
    await saveClipEditable(candidate);
    return {
      candidate,
      prontosPath,
      prontosRelativePath,
      runId,
      elapsedMs: Date.now() - t0,
      previewShorterThanMarked: previewShorterThanMarked || undefined,
    };
  }

  const mainPath = hookRange
    ? path.join(exportDir, `${candidateId}_main.mp4`)
    : localFinalPath;
  const hookPath = hookRange
    ? path.join(exportDir, `${candidateId}_hook.mp4`)
    : null;

  let assForBurn: string | null = null;
  if (input.useSubtitles) {
    const transcriptPath = path.join(
      vodDir,
      candidate.clipTranscriptRelativePath ??
        `transcripts/${candidateId}.json`
    );
    try {
      await fs.access(transcriptPath);
    } catch {
      throw new Error(
        `Clip transcript not found for candidate ${candidateId}. Run POST /candidates/${candidateId}/transcribe-clip first.`
      );
    }

    const rangeStart = input.subtitleRange?.start ?? 0;
    const rangeEnd = input.subtitleRange?.end ?? 1e9;

    const captionOpts: Parameters<typeof writeClipCaptions>[0] = {
      transcriptPath,
      clipStart: rangeStart,
      clipEnd: rangeEnd,
      layoutPresetId: input.preset,
      outputAssPath: workAssPath,
      playResOverride: { w: outW, h: outH },
      keepAbsoluteTimes: true,
    };

    if (rampActive && speedRamp) {
      captionOpts.remapTime = (t) => mapInputTimeThroughSpeedRamp(t, speedRamp);
    } else if (speedChanged) {
      captionOpts.timeScale = 1 / speed;
    }

    await writeClipCaptions(captionOpts);
    assForBurn = workAssPath;
  }

  const layoutFilter = buildFilterComplex(layout);
  if (!layoutFilter) {
    throw new Error(`Could not build layout filter for preset ${input.preset}`);
  }

  // Video chain after layout label [vout] (split) or as -vf chain (non-split)
  // Order: zoom → color → setpts (speed/ramp) → draft scale → [overlays] → subtitles
  const postLayoutCoreParts: string[] = [];

  if (zoomKeyframes) {
    postLayoutCoreParts.push(buildZoomFilterExpr(zoomKeyframes, zoomW, zoomH));
  }

  const colorTiming = normalizeColorEffectTiming(
    input.colorEffectStart,
    input.colorEffectEnd,
    input.colorFadeSeconds
  );
  const mainColorFilter = colorPresetFilterExpr(
    colorPreset,
    input.colorIntensityPercent ?? 100,
    colorTiming
  );
  if (mainColorFilter) {
    postLayoutCoreParts.push(mainColorFilter);
  }

  if (rampActive && speedRamp) {
    postLayoutCoreParts.push(buildSpeedRampSetptsExpr(speedRamp));
  } else if (speedChanged) {
    postLayoutCoreParts.push(`setpts=PTS/${Number(speed.toFixed(6))}`);
  }

  if (quality.resolutionScale !== 1) {
    postLayoutCoreParts.push(`scale=${outW}:${outH}`);
  }

  let subtitleFilter: string | null = null;
  if (assForBurn) {
    const fontsDir = getCaptionFontsDir();
    const escapedAss = assForBurn.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedFonts = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
    subtitleFilter = `subtitles='${escapedAss}':fontsdir='${escapedFonts}'`;
  }

  // Legacy combined chain (no library effects): core + subtitles
  const postLayoutParts = [...postLayoutCoreParts];
  if (subtitleFilter) postLayoutParts.push(subtitleFilter);
  const postLayout = postLayoutParts.join(",");
  const postLayoutCore = postLayoutCoreParts.join(",");

  const rampAudio =
    rampActive && speedRamp
      ? buildRampAudioFilter(speedRamp, clipDuration)
      : "";

  const libraryEffects = loadEffectsForExport(candidateId);
  const hasLibraryEffects = libraryEffects.length > 0;

  const args: string[] = [];
  pushCappedPreviewInput(
    args,
    previewPath,
    clipDuration,
    hasClipWindow ? previewOffsetSec : 0
  );

  if (hasLibraryEffects) {
    // Additive library effects path — clipes sem efeitos continuam no branch abaixo.
    const inputIndexes = appendEffectInputs(args, libraryEffects);
    // Always filter_complex when library effects exist (extra inputs).
    const filterParts: string[] = [];

    if (layout.split) {
      filterParts.push(layoutFilter);
      if (postLayoutCore) {
        filterParts.push(`[vout]${postLayoutCore}[vcore]`);
      } else {
        filterParts.push(`[vout]null[vcore]`);
      }
    } else {
      const vfCore = [layoutFilter, postLayoutCore].filter(Boolean).join(",");
      filterParts.push(`[0:v]${vfCore}[vcore]`);
    }

    if (hasVideoEffects(libraryEffects)) {
      filterParts.push(
        buildVideoOverlayFilters(
          libraryEffects,
          inputIndexes,
          outW,
          outH,
          "vcore",
          "vovl",
          "",
          clipDuration
        )
      );
    } else {
      filterParts.push(`[vcore]null[vovl]`);
    }

    if (subtitleFilter) {
      filterParts.push(`[vovl]${subtitleFilter}[vfinal]`);
    } else {
      filterParts.push(`[vovl]null[vfinal]`);
    }

    // Audio: prepare main (tempo/duck) then mix music/sfx
    let tempoFilter: string | null = null;
    const audioParts: string[] = [];
    let mapAudio = "0:a?";

    if (rampAudio) {
      if (hasAudioEffects(libraryEffects)) {
        // Retarget ramp output to [amain], optional duck, then mix fx → [aout]
        audioParts.push(rampAudio.replace(/\[aout\]/g, "[aramp]"));
        const duckPrep = buildMainAudioPrepare(libraryEffects, null);
        let mainForMix = "aramp";
        if (duckPrep) {
          const duckExprMatch = duckPrep.match(/volume='([^']+)'/);
          if (duckExprMatch) {
            audioParts.push(
              `[aramp]volume='${duckExprMatch[1]}':eval=frame[amain]`
            );
            mainForMix = "amain";
          }
        }
        const mix = buildAudioFxMixOntoLabel(
          libraryEffects,
          inputIndexes,
          mainForMix
        );
        if (mix) audioParts.push(mix);
        mapAudio = "[aout]";
      } else {
        audioParts.push(rampAudio);
        mapAudio = "[aout]";
      }
    } else {
      if (speedChanged) {
        tempoFilter = buildAtempoChain(speed);
        if (!tempoFilter) {
          throw new Error(`Could not build atempo chain for speed=${speed}`);
        }
      }
      const prepare = buildMainAudioPrepare(libraryEffects, tempoFilter);
      if (hasAudioEffects(libraryEffects)) {
        if (prepare) {
          audioParts.push(prepare);
          const mix = buildAudioFxMixOntoLabel(
            libraryEffects,
            inputIndexes,
            "amain"
          );
          if (mix) audioParts.push(mix);
        } else {
          const mix = buildAudioFxMixOntoLabel(
            libraryEffects,
            inputIndexes,
            "0:a"
          );
          if (mix) audioParts.push(mix);
        }
        mapAudio = "[aout]";
      } else if (prepare) {
        audioParts.push(prepare.replace(/\[amain\]/g, "[aout]"));
        mapAudio = "[aout]";
      } else if (tempoFilter) {
        audioParts.push(`[0:a]${tempoFilter}[aout]`);
        mapAudio = "[aout]";
      }
    }

    let videoChain = filterParts.join(";");
    if (audioParts.length > 0) {
      videoChain += `;${audioParts.join(";")}`;
    }
    args.push(
      "-filter_complex",
      videoChain,
      "-map",
      "[vfinal]",
      "-map",
      mapAudio
    );
  } else if (layout.split) {
    // layoutFilter already ends with [vout]
    let videoChain = layoutFilter;
    if (postLayout) {
      videoChain += `;[vout]${postLayout}[vfinal]`;
    }
    const vMap = postLayout ? "[vfinal]" : "[vout]";

    if (rampAudio) {
      videoChain += `;${rampAudio}`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      if (!atempo) {
        throw new Error(`Could not build atempo chain for speed=${speed}`);
      }
      videoChain += `;[0:a]${atempo}[aout]`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else {
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "0:a?");
    }
  } else {
    // Non-split: layoutFilter is a plain scale=… chain
    const vfParts = [layoutFilter];
    if (postLayout) vfParts.push(postLayout);
    const vf = vfParts.join(",");

    if (rampAudio) {
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];${rampAudio}`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];[0:a]${atempo}[aout]`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
    }
  }

  args.push(
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
    mainPath
  );

  await runFfmpeg(args);

  if (hookRange && hookPath) {
    await renderHookSegment({
      previewPath,
      hookStart: hookRange.start,
      hookEnd: hookRange.end,
      layoutFilter,
      split: Boolean(layout.split),
      outW,
      outH,
      zoomW,
      zoomH,
      colorPreset,
      resolutionScale: quality.resolutionScale,
      crf: quality.crf,
      x264Preset: quality.x264Preset,
      audioBitrate: quality.audioBitrate,
      outputPath: hookPath,
    });
    await concatDemuxerCopy([hookPath, mainPath], localFinalPath);
    await fs.unlink(hookPath).catch(() => undefined);
    await fs.unlink(mainPath).catch(() => undefined);
  }

  const { runId } = await getCurrentRun(vodId);
  const runDir = path.join(vodDir, "prontos", runId);
  await fs.mkdir(runDir, { recursive: true });
  const fileName = `${candidateId}_final.mp4`;
  const prontosPath = path.join(runDir, fileName);
  await fs.copyFile(localFinalPath, prontosPath);

  const prontosRelativePath = `prontos/${runId}/${fileName}`;
  candidate.status = "exported";
  candidate.exportRelativePath = prontosRelativePath;
  await saveClipEditable(candidate);

  return {
    candidate,
    prontosPath,
    prontosRelativePath,
    runId,
    elapsedMs: Date.now() - t0,
    previewShorterThanMarked: previewShorterThanMarked || undefined,
  };
}

export type RenderProcessedSegmentInput = {
  previewPath: string;
  segmentStart: number;
  segmentDuration: number;
  layoutPresetId: string;
  quality: QualityId;
  zoomKeyframes?: ZoomKeyframe[] | null;
  speedRamp?: SpeedRampPoint[] | null;
  speed?: number;
  colorPreset?: ColorPresetId;
  outputPath: string;
  /** 0–200, scales color preset magnitude (100 = recipe baseline). */
  colorIntensityPercent?: number;
  /** Clip-relative color window (emotion preset preview/export). */
  colorEffectStart?: number;
  colorEffectEnd?: number;
  colorFadeSeconds?: number;
  /** Process entire preview file with clip-relative keyframes (preset preview export). */
  fullClip?: boolean;
  /** NVENC for faithful preview-render only; default libx264. */
  videoEncoder?: PreviewVideoEncoder;
  /** Additional gated color filters (multi-preset preview). */
  extraColorFilters?: string[];
};

/** Interpolate zoom props at clip-relative time t. */
export function interpolateZoomAt(
  keyframes: ZoomKeyframe[],
  t: number
): Pick<ZoomKeyframe, "scale" | "x" | "y"> {
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

/** Remap clip-relative keyframes to a trimmed window (t=0 at windowStart). */
export function shiftZoomKeyframesForWindow(
  keyframes: ZoomKeyframe[],
  windowStart: number,
  windowDuration: number
): ZoomKeyframe[] | null {
  if (keyframes.length === 0) return null;
  const atStart = interpolateZoomAt(keyframes, windowStart);
  const shifted: ZoomKeyframe[] = [
    {
      time: 0,
      scale: atStart.scale,
      x: atStart.x,
      y: atStart.y,
    },
  ];
  for (const kf of keyframes) {
    const t = kf.time - windowStart;
    if (t > 0.001 && t <= windowDuration + 0.001) {
      shifted.push({
        time: Number(t.toFixed(3)),
        scale: kf.scale,
        x: kf.x,
        y: kf.y,
      });
    }
  }
  return shifted.length > 0 ? shifted : null;
}

function speedAtTime(ramp: SpeedRampPoint[], t: number): number {
  const pts = effectiveSpeedRamp(ramp);
  let speed = pts[0]?.speed ?? 1;
  for (const p of pts) {
    if (p.time <= t) speed = p.speed;
    else break;
  }
  return speed;
}

/** Remap clip-relative speed ramp to a trimmed window. */
export function shiftSpeedRampForWindow(
  ramp: SpeedRampPoint[] | null,
  windowStart: number,
  windowDuration: number
): SpeedRampPoint[] | null {
  if (!ramp || ramp.length === 0) return null;
  const windowEnd = windowStart + windowDuration;
  const speedAtStart = speedAtTime(ramp, windowStart);
  const speedAtEnd = speedAtTime(ramp, windowEnd);
  const shifted: SpeedRampPoint[] = [{ time: 0, speed: speedAtStart }];
  const pts = effectiveSpeedRamp(ramp);
  for (const p of pts) {
    if (p.time > windowStart + 0.001 && p.time < windowEnd - 0.001) {
      shifted.push({
        time: Number((p.time - windowStart).toFixed(3)),
        speed: p.speed,
      });
    }
  }
  const last = shifted[shifted.length - 1];
  if (
    Math.abs(last.speed - speedAtEnd) > 1e-6 ||
    last.time < windowDuration - 0.001
  ) {
    shifted.push({
      time: Number(windowDuration.toFixed(3)),
      speed: speedAtEnd,
    });
  }
  const normalized = normalizeSpeedRamp(shifted);
  if (!normalized) return null;
  const allOne = normalized.every((p) => Math.abs(p.speed - 1) < 1e-6);
  return allOne ? null : normalized;
}

/**
 * Render preview with the same zoom/color/speed pipeline as export (no subtitles).
 * fullClip=true: entire previews/{id}.mp4 with clip-relative keyframes (preset preview).
 * Otherwise: trim via -ss/-t and remap keyframes to the window.
 */
export async function renderProcessedPreviewSegment(
  input: RenderProcessedSegmentInput
): Promise<void> {
  const quality = getQualityPreset(input.quality);
  if (!quality) {
    throw new Error(`Invalid quality: ${input.quality}`);
  }

  const layout = getLayoutPreset(input.layoutPresetId);
  if (!layout) {
    throw new Error(`Unknown layout preset: ${input.layoutPresetId}`);
  }

  const fullClip = input.fullClip === true;
  const segmentStart = fullClip ? 0 : Math.max(0, input.segmentStart);
  const segmentDuration = Math.max(0.1, input.segmentDuration);

  const zoomKeyframes = fullClip
    ? normalizeZoomKeyframes(input.zoomKeyframes ?? undefined)
    : shiftZoomKeyframesForWindow(
        input.zoomKeyframes ?? [],
        segmentStart,
        segmentDuration
      );
  const speedRamp = fullClip
    ? normalizeSpeedRamp(input.speedRamp ?? undefined)
    : shiftSpeedRampForWindow(
        input.speedRamp ?? null,
        segmentStart,
        segmentDuration
      );

  const colorPreset: ColorPresetId =
    input.colorPreset == null || input.colorPreset === "none"
      ? "none"
      : input.colorPreset;
  if (!isKnownColorPreset(colorPreset)) {
    throw new Error(`Unknown colorPreset: ${colorPreset}`);
  }

  const nativeW = layout.outputResolution.w;
  const nativeH = layout.outputResolution.h;
  const outW = evenDim(nativeW * quality.resolutionScale);
  const outH = evenDim(nativeH * quality.resolutionScale);
  const zoomW = nativeW;
  const zoomH = nativeH;

  const speed = speedRamp ? 1 : (input.speed ?? 1);
  const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;
  const rampActive = speedRamp != null;

  const layoutFilter = buildFilterComplex(layout);
  if (!layoutFilter) {
    throw new Error(`Could not build layout filter for preset ${input.layoutPresetId}`);
  }

  const postLayoutParts: string[] = [];
  if (zoomKeyframes) {
    postLayoutParts.push(buildZoomFilterExpr(zoomKeyframes, zoomW, zoomH));
  }
  let colorTiming = normalizeColorEffectTiming(
    input.colorEffectStart,
    input.colorEffectEnd,
    input.colorFadeSeconds
  );
  // Non-fullClip window uses -ss; remap color times to window-relative like zoom.
  if (colorTiming && !fullClip) {
    colorTiming = {
      start: Math.max(0, colorTiming.start - segmentStart),
      end: Math.max(0, colorTiming.end - segmentStart),
      fadeSeconds: colorTiming.fadeSeconds,
    };
    if (!(colorTiming.end > colorTiming.start)) {
      colorTiming = null;
    }
  }
  const colorFilter = colorPresetFilterExpr(
    colorPreset,
    input.colorIntensityPercent ?? 100,
    colorTiming
  );
  if (colorFilter) {
    postLayoutParts.push(colorFilter);
  }
  for (const cf of input.extraColorFilters ?? []) {
    postLayoutParts.push(cf);
  }
  if (rampActive && speedRamp) {
    postLayoutParts.push(buildSpeedRampSetptsExpr(speedRamp));
  } else if (speedChanged) {
    postLayoutParts.push(`setpts=PTS/${Number(speed.toFixed(6))}`);
  }
  if (quality.resolutionScale !== 1) {
    postLayoutParts.push(`scale=${outW}:${outH}`);
  }
  const postLayout = postLayoutParts.join(",");

  const rampAudio =
    rampActive && speedRamp
      ? buildRampAudioFilter(speedRamp, segmentDuration)
      : "";

  const args: string[] = ["-i", input.previewPath];
  if (!fullClip) {
    args.push(
      "-ss",
      String(Number(segmentStart.toFixed(6))),
      "-t",
      String(Number(segmentDuration.toFixed(6)))
    );
  } else {
    args.push("-t", String(Number(segmentDuration.toFixed(6))));
  }

  if (layout.split) {
    let videoChain = layoutFilter;
    if (postLayout) {
      videoChain += `;[vout]${postLayout}[vfinal]`;
    }
    const vMap = postLayout ? "[vfinal]" : "[vout]";

    if (rampAudio) {
      videoChain += `;${rampAudio}`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      videoChain += `;[0:a]${atempo}[aout]`;
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "[aout]");
    } else {
      args.push("-filter_complex", videoChain, "-map", vMap, "-map", "0:a?");
    }
  } else {
    const vfParts = [layoutFilter];
    if (postLayout) vfParts.push(postLayout);
    const vf = vfParts.join(",");

    if (rampAudio) {
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];${rampAudio}`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else if (speedChanged) {
      const atempo = buildAtempoChain(speed);
      args.push(
        "-filter_complex",
        `[0:v]${vf}[vfinal];[0:a]${atempo}[aout]`,
        "-map",
        "[vfinal]",
        "-map",
        "[aout]"
      );
    } else {
      args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
    }
  }

  appendVideoEncoderArgs(args, {
    encoder: input.videoEncoder ?? "libx264",
    crf: quality.crf,
    x264Preset: quality.x264Preset,
    audioBitrate: quality.audioBitrate,
    outputPath: input.outputPath,
  });

  await runFfmpeg(args);

  const st = await fs.stat(input.outputPath);
  if (!(st.size > 0)) {
    throw new Error(`Preview segment is empty at ${input.outputPath}`);
  }
}

export type FaithfulPreviewWindowInput = ExportCandidateInput & {
  candidateId: string;
  previewPath: string;
  clipDuration: number;
  windowStart: number;
  windowEnd: number;
  outputPath: string;
  workDir: string;
  extraColorFilters?: string[];
};

/**
 * Faithful ffmpeg preview for a clip-relative window (NVENC).
 * Reuses renderProcessedPreviewSegment + library effects + subtitle burn.
 * Does not alter exportCandidate behavior.
 */
export async function renderFaithfulPreviewWindow(
  input: FaithfulPreviewWindowInput
): Promise<void> {
  const quality = getQualityPreset("draft");
  if (!quality) {
    throw new Error("draft quality preset missing");
  }
  const layout = getLayoutPreset(input.preset);
  if (!layout) {
    throw new Error(`Unknown layout preset: ${input.preset}`);
  }

  const windowStart = Math.max(0, input.windowStart);
  const windowEnd = Math.min(input.clipDuration, input.windowEnd);
  const windowDuration = Math.max(0.1, windowEnd - windowStart);
  if (!(windowEnd > windowStart)) {
    throw new Error("windowEnd must be greater than windowStart");
  }

  const outW = evenDim(
    layout.outputResolution.w * quality.resolutionScale
  );
  const outH = evenDim(
    layout.outputResolution.h * quality.resolutionScale
  );

  await fs.mkdir(input.workDir, { recursive: true });
  const corePath = path.join(input.workDir, "core.mp4");

  if (input.wastedInsert) {
    const fullPath = path.join(input.workDir, "wasted_full.mp4");
    const w = input.wastedInsert;
    await renderWastedInsertClip({
      previewPath: input.previewPath,
      clipDuration: input.clipDuration,
      insertAtTime: w.insertAtTime,
      effectDuration: w.effectDuration,
      intensityPercent:
        w.intensityPercent ?? input.colorIntensityPercent ?? 100,
      layoutPresetId: input.preset,
      quality: "draft",
      outputPath: fullPath,
      workDir: path.join(input.workDir, "wasted_work"),
    });
    await runFfmpeg([
      "-ss",
      String(Number(windowStart.toFixed(6))),
      "-t",
      String(Number(windowDuration.toFixed(6))),
      "-i",
      fullPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      corePath,
    ]);
  } else {
    const zoomKeyframes = normalizeZoomKeyframes(input.zoomKeyframes);
    const speedRamp = normalizeSpeedRamp(input.speedRamp);
    const colorPreset: ColorPresetId =
      input.colorPreset == null || input.colorPreset === "none"
        ? "none"
        : input.colorPreset;

    await renderProcessedPreviewSegment({
      previewPath: input.previewPath,
      segmentStart: windowStart,
      segmentDuration: windowDuration,
      layoutPresetId: input.preset,
      quality: "draft",
      zoomKeyframes,
      speedRamp,
      speed: input.speed,
      colorPreset,
      colorIntensityPercent: input.colorIntensityPercent,
      colorEffectStart: input.colorEffectStart,
      colorEffectEnd: input.colorEffectEnd,
      colorFadeSeconds: input.colorFadeSeconds,
      outputPath: corePath,
      fullClip: false,
      videoEncoder: "h264_nvenc",
      extraColorFilters: input.extraColorFilters,
    });
  }

  const shiftedEffects = loadEffectsForExport(input.candidateId)
    .map((row) => {
      const inst = row.instance;
      const partStart = inst.sourceTrimStart ?? 0;
      const partEnd = inst.sourceTrimEnd ?? partStart + 1;
      const partDur = Math.max(0.05, partEnd - partStart);
      const clipTs = inst.clipTimestamp ?? 0;
      const relStart = clipTs - windowStart;
      if (relStart + partDur <= 0 || relStart >= windowDuration) {
        return null;
      }
      return {
        ...row,
        instance: {
          ...inst,
          clipTimestamp: Number(Math.max(0, relStart).toFixed(3)),
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const withFxPath = path.join(input.workDir, "with_fx.mp4");
  await applyLibraryEffectsOntoFile({
    inputPath: corePath,
    outputPath: withFxPath,
    effects: shiftedEffects,
    frameW: outW,
    frameH: outH,
    crf: quality.crf,
    x264Preset: quality.x264Preset,
    audioBitrate: quality.audioBitrate,
    videoEncoder: "h264_nvenc",
  });

  let currentPath = withFxPath;

  if (input.useSubtitles) {
    const editable = await findClipEditableById(input.candidateId);
    const vodDir = path.dirname(path.dirname(input.previewPath));
    const transcriptPath = path.join(
      vodDir,
      editable.clipTranscriptRelativePath ??
        `transcripts/${input.candidateId}.json`
    );
    try {
      await fs.access(transcriptPath);
    } catch {
      throw new Error(
        `Clip transcript not found for candidate ${input.candidateId}. Run transcribe-clip first.`
      );
    }

    const rawTranscript = await fs.readFile(transcriptPath, "utf-8");
    const baseTranscript = JSON.parse(rawTranscript) as Transcript;
    const transcriptForCaptions = input.subtitleSnapshot
      ? mergeSubtitleRenderSnapshot(baseTranscript, input.subtitleSnapshot)
      : baseTranscript;

    const rangeStart = input.subtitleRange?.start ?? 0;
    const rangeEnd = input.subtitleRange?.end ?? input.clipDuration;
    const assPath = path.join(input.workDir, "window.ass");

    const speedRamp = normalizeSpeedRamp(input.speedRamp);
    const speed = speedRamp ? 1 : input.speed;
    const speedChanged = !speedRamp && Math.abs(speed - 1) > 1e-6;

    const captionOpts: Parameters<typeof writeClipCaptions>[0] = {
      transcriptPath,
      clipStart: Math.max(rangeStart, windowStart),
      clipEnd: Math.min(rangeEnd, windowEnd),
      layoutPresetId: input.preset,
      outputAssPath: assPath,
      playResOverride: { w: outW, h: outH },
      keepAbsoluteTimes: false,
    };

    if (speedRamp) {
      captionOpts.remapTime = (t) => mapInputTimeThroughSpeedRamp(t, speedRamp);
    } else if (speedChanged) {
      captionOpts.timeScale = 1 / speed;
    }

    await writeClipCaptions({
      ...captionOpts,
      subtitleSettings: transcriptForCaptions.subtitle,
      transcriptOverride: transcriptForCaptions,
    });

    const fontsDir = getCaptionFontsDir();
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const escapedFonts = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
    const subtitledPath = path.join(input.workDir, "subtitled.mp4");

    await runFfmpeg([
      "-i",
      currentPath,
      "-vf",
      `subtitles='${escapedAss}':fontsdir='${escapedFonts}'`,
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p4",
      "-tune",
      "ll",
      "-cq",
      String(Math.min(quality.crf + 6, 32)),
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      subtitledPath,
    ]);
    currentPath = subtitledPath;
  }

  await fs.copyFile(currentPath, input.outputPath);
}

export type RenderWastedInsertInput = {
  previewPath: string;
  clipDuration: number;
  /** Clip-relative second where the Wasted insert begins. */
  insertAtTime: number;
  /** Screen duration of the Wasted segment (seconds). */
  effectDuration: number;
  intensityPercent?: number;
  layoutPresetId: string;
  quality?: QualityId;
  outputPath: string;
  workDir?: string;
  /** Input is already layout-rendered (multi-preset sequential path). */
  skipLayout?: boolean;
};

export type RenderWastedInsertResult = {
  /** Final duration equals clipDuration (in-place, no extension). */
  expectedDuration: number;
  sourceSeconds: number;
  insertAtTime: number;
  effectDuration: number;
  summary: string;
};

/**
 * Wasted in-place pipeline:
 *   [0, insertAt) + [slow-mo graded segment of effectDuration] + [insertAt+effectDuration, end)
 * Final duration = clipDuration (no extension, no scene repeat).
 */
export async function renderWastedInsertClip(
  input: RenderWastedInsertInput
): Promise<RenderWastedInsertResult> {
  const qualityPreset = getQualityPreset(input.quality ?? "draft");
  if (!qualityPreset) {
    throw new Error(`Invalid quality: ${input.quality}`);
  }
  const layout = getLayoutPreset(input.layoutPresetId);
  if (!layout) {
    throw new Error(`Unknown layout preset: ${input.layoutPresetId}`);
  }

  const clipDuration = Math.max(0.1, input.clipDuration);
  const insertAt = clampNum(input.insertAtTime, 0, clipDuration);
  const effectDuration = Math.max(0.5, input.effectDuration);
  const intensityPercent = clampNum(input.intensityPercent ?? 100, 0, 200);
  const f = intensityPercent / 100;
  // Same formula as scaleWastedEndSpeed: @100% → 0.45x
  const endSpeed = clampNum(1 - 0.55 * f, 0.25, 1.0);
  let sourceSeconds = effectDuration * endSpeed;
  const maxSrc = Math.max(0.05, clipDuration - insertAt);
  if (sourceSeconds > maxSrc) {
    sourceSeconds = maxSrc;
  }
  sourceSeconds = Number(Math.max(0.05, sourceSeconds).toFixed(3));

  const layoutFilterRaw = buildFilterComplex(layout);
  if (!layoutFilterRaw && !input.skipLayout) {
    throw new Error(`Could not build layout filter for preset ${input.layoutPresetId}`);
  }
  const layoutFilter: string = layoutFilterRaw ?? "";
  const isSplit = Boolean(layout.split);
  const skipLayout = input.skipLayout === true;

  const nativeW = layout.outputResolution.w;
  const nativeH = layout.outputResolution.h;
  const outW = evenDim(nativeW * qualityPreset.resolutionScale);
  const outH = evenDim(nativeH * qualityPreset.resolutionScale);
  const cameraW = skipLayout ? outW : nativeW;
  const cameraH = skipLayout ? outH : nativeH;
  const resScale = qualityPreset.resolutionScale;
  const crf = qualityPreset.crf;
  const x264Preset = qualityPreset.x264Preset;
  const audioBitrate = qualityPreset.audioBitrate;

  const workDir =
    input.workDir ??
    path.join(path.dirname(input.outputPath), `.wasted_${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const partBefore = path.join(workDir, "before.mp4");
  const partWasted = path.join(workDir, "wasted.mp4");
  const partAfter = path.join(workDir, "after.mp4");

  const encodeTail = [
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-movflags",
    "+faststart",
  ];

  async function renderPlainSegment(
    start: number,
    duration: number,
    outputPath: string
  ): Promise<void> {
    if (!(duration > 0.01)) return;
    const post: string[] = [];
    if (resScale !== 1) {
      post.push(`scale=${outW}:${outH}`);
    }
    const postLayout = post.join(",");
    const args: string[] = [
      "-ss",
      String(Number(start.toFixed(6))),
      "-t",
      String(Number(duration.toFixed(6))),
      "-i",
      input.previewPath,
    ];
    if (skipLayout) {
      if (postLayout) {
        args.push("-vf", postLayout, "-map", "0:v", "-map", "0:a?");
      } else {
        args.push("-map", "0:v", "-map", "0:a?");
      }
    } else if (isSplit) {
      let chain = layoutFilter;
      if (postLayout) chain += `;[vout]${postLayout}[vfinal]`;
      const vMap = postLayout ? "[vfinal]" : "[vout]";
      args.push("-filter_complex", chain, "-map", vMap, "-map", "0:a?");
    } else {
      const vf = postLayout
        ? `${layoutFilter},${postLayout}`
        : layoutFilter;
      args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
    }
    args.push(...encodeTail, outputPath);
    await runFfmpeg(args);
  }

  async function renderWastedSegment(): Promise<void> {
    const speed = sourceSeconds / effectDuration; // < 1 → slow-mo
    const setpts = `setpts=PTS/${Number(speed.toFixed(6))}`;
    // Pitch-preserving slowdown (rubberband). atempo alone sounded like
    // pitch-dropped vinyl on this extreme tempo (~0.45x).
    const audioTempo = buildPitchPreservingTempo(speed);
    const camera = buildWastedCameraFilterExpr(
      effectDuration,
      intensityPercent,
      cameraW,
      cameraH
    );
    // Color after setpts so t is screen-relative over [0, effectDuration]
    const color = colorPresetFilterExpr("wasted_grayscale", intensityPercent, {
      start: 0,
      end: effectDuration,
      fadeSeconds: 0.25,
    });

    // Order: layout → stretch → camera → color → draft scale
    const postParts: string[] = [setpts, camera];
    if (color) postParts.push(color);
    if (resScale !== 1) {
      postParts.push(`scale=${outW}:${outH}`);
    }
    const postLayout = postParts.join(",");

    const args: string[] = [
      "-ss",
      String(Number(insertAt.toFixed(6))),
      "-t",
      String(Number(sourceSeconds.toFixed(6))),
      "-i",
      input.previewPath,
    ];

    if (skipLayout) {
      const vf = postLayout;
      if (audioTempo) {
        args.push(
          "-filter_complex",
          `[0:v]${vf}[vfinal];[0:a]${audioTempo},asetpts=PTS-STARTPTS[aout]`,
          "-map",
          "[vfinal]",
          "-map",
          "[aout]"
        );
      } else {
        args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
      }
    } else if (isSplit) {
      let chain = `${layoutFilter};[vout]${postLayout}[vfinal]`;
      if (audioTempo) {
        chain += `;[0:a]${audioTempo},asetpts=PTS-STARTPTS[aout]`;
        args.push(
          "-filter_complex",
          chain,
          "-map",
          "[vfinal]",
          "-map",
          "[aout]"
        );
      } else {
        args.push(
          "-filter_complex",
          chain,
          "-map",
          "[vfinal]",
          "-map",
          "0:a?"
        );
      }
    } else {
      const vf = `${layoutFilter},${postLayout}`;
      if (audioTempo) {
        args.push(
          "-filter_complex",
          `[0:v]${vf}[vfinal];[0:a]${audioTempo},asetpts=PTS-STARTPTS[aout]`,
          "-map",
          "[vfinal]",
          "-map",
          "[aout]"
        );
      } else {
        args.push("-vf", vf, "-map", "0:v", "-map", "0:a?");
      }
    }
    args.push(...encodeTail, partWasted);
    await runFfmpeg(args);
  }

  const concatParts: string[] = [];
  try {
    if (insertAt > 0.05) {
      await renderPlainSegment(0, insertAt, partBefore);
      concatParts.push(partBefore);
    }
    await renderWastedSegment();
    concatParts.push(partWasted);
    const afterStart = insertAt + effectDuration;
    const afterDur = clipDuration - afterStart;
    if (afterDur > 0.05) {
      await renderPlainSegment(afterStart, afterDur, partAfter);
      concatParts.push(partAfter);
    }

    if (concatParts.length === 1) {
      await fs.copyFile(concatParts[0], input.outputPath);
    } else {
      await concatDemuxerCopy(concatParts, input.outputPath);
    }

    const st = await fs.stat(input.outputPath);
    if (!(st.size > 0)) {
      throw new Error(`Wasted output is empty at ${input.outputPath}`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const expectedDuration = clipDuration;
  const finalSat = clampNum(1 - f, 0, 1);
  return {
    expectedDuration: Number(expectedDuration.toFixed(3)),
    sourceSeconds,
    insertAtTime: Number(insertAt.toFixed(3)),
    effectDuration: Number(effectDuration.toFixed(3)),
    summary: `Wasted in-place@${insertAt.toFixed(1)}s ×${effectDuration.toFixed(1)}s — P&B→${finalSat.toFixed(2)}, ${endSpeed.toFixed(2)}x, zoom-out+roll, ${intensityPercent}%`,
  };
}

