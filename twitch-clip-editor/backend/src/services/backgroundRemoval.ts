/**
 * Background removal modes for library video overlays.
 */

export type BackgroundRemovalMode =
  | "chroma"
  | "solid"
  | "luminance"
  | "screen"
  | "none";

export const DEFAULT_BACKGROUND_REMOVAL_MODE: BackgroundRemovalMode = "chroma";

export function parseBackgroundRemovalMode(
  raw: string | null | undefined
): BackgroundRemovalMode {
  if (
    raw === "solid" ||
    raw === "luminance" ||
    raw === "screen" ||
    raw === "none"
  ) {
    return raw;
  }
  return DEFAULT_BACKGROUND_REMOVAL_MODE;
}

export function backgroundRemovalUsesColorParams(
  mode: BackgroundRemovalMode
): boolean {
  return mode === "chroma" || mode === "solid" || mode === "luminance";
}

export function buildBackgroundKeyFilterExpr(
  mode: BackgroundRemovalMode,
  color: string,
  sim: number,
  blend: number,
  fmt: (n: number) => string
): string | null {
  switch (mode) {
    case "none":
    case "screen":
      return null;
    case "chroma":
      return `chromakey=${color}:${fmt(sim)}:${fmt(blend)}`;
    case "solid":
      return `colorkey=${color}:${fmt(sim)}:${fmt(blend)}`;
    case "luminance": {
      const threshold = fmt(Math.min(0.5, 0.02 + sim * 0.15));
      return `lumakey=${threshold}:${fmt(sim)}:${fmt(blend)}`;
    }
  }
}
