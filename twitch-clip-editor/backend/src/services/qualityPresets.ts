/**
 * Export quality presets (Sprint D). CRF only — never -b:v.
 * Resolution is relative to the chosen layout's native outputResolution.
 */
export type QualityId = "draft" | "hd" | "max";

export type QualityEncode = {
  id: QualityId;
  /** Multiplier on layout native width/height (draft = 0.5). */
  resolutionScale: number;
  crf: number;
  audioBitrate: string;
  x264Preset: string;
};

export const QUALITY_PRESETS: Record<QualityId, QualityEncode> = {
  draft: {
    id: "draft",
    resolutionScale: 0.5,
    crf: 28,
    audioBitrate: "96k",
    x264Preset: "veryfast",
  },
  hd: {
    id: "hd",
    resolutionScale: 1,
    crf: 21,
    audioBitrate: "192k",
    x264Preset: "medium",
  },
  max: {
    id: "max",
    resolutionScale: 1,
    crf: 17,
    audioBitrate: "320k",
    x264Preset: "slow",
  },
};

export function getQualityPreset(id: string): QualityEncode | undefined {
  if (id === "draft" || id === "hd" || id === "max") {
    return QUALITY_PRESETS[id];
  }
  return undefined;
}

/** Even dimension for libx264. */
export function evenDim(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}
