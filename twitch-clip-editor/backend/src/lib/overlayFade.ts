/** Final clip width (9:16 vertical). Used for resolution guidance only — never upscales files. */
export const EXPORT_FRAME_WIDTH = 1080;

export function maxNativeWidthPercent(imageNativeWidth: number): number {
  if (!(imageNativeWidth > 0)) return 100;
  return Math.min(100, (imageNativeWidth / EXPORT_FRAME_WIDTH) * 100);
}

export function normalizeVisualFades(
  partDuration: number,
  fadeIn: number,
  fadeOut: number
): { fadeIn: number; fadeOut: number; adjusted: boolean } {
  let fi = Math.max(0, fadeIn);
  let fo = Math.max(0, fadeOut);
  if (partDuration <= 0) return { fadeIn: 0, fadeOut: 0, adjusted: false };
  if (fi + fo > partDuration) {
    const scale = partDuration / (fi + fo);
    fi *= scale;
    fo *= scale;
    return { fadeIn: fi, fadeOut: fo, adjusted: true };
  }
  return { fadeIn: fi, fadeOut: fo, adjusted: false };
}

/** FFmpeg `fade` uses linear alpha interpolation (st..st+d). */
export function ffmpegLinearFadeOpacity(
  localT: number,
  partDuration: number,
  fadeIn: number,
  fadeOut: number
): number {
  if (localT < 0 || localT > partDuration) return 0;
  if (fadeIn > 0 && localT < fadeIn) return localT / fadeIn;
  if (fadeOut > 0 && localT > partDuration - fadeOut) {
    return Math.max(0, (partDuration - localT) / fadeOut);
  }
  return 1;
}
