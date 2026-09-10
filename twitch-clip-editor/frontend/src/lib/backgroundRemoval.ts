export type BackgroundRemovalMode =
  | "chroma"
  | "solid"
  | "luminance"
  | "screen"
  | "none";

export const DEFAULT_BACKGROUND_REMOVAL_MODE: BackgroundRemovalMode = "chroma";

export const BACKGROUND_REMOVAL_LABELS: Record<BackgroundRemovalMode, string> = {
  chroma: "chroma (verde/azul)",
  solid: "cor sólida",
  luminance: "luminância",
  screen: "screen",
  none: "nenhuma",
};

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
