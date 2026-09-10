/**
 * Composition-wide color grade (reuses L2 presets — contract §20 C3).
 */

export type ColorPresetId =
  | "none"
  | "vivid"
  | "vivid_contrast"
  | "cold_desaturated"
  | "wasted_grayscale";

export type CompositionColorSettings = {
  enabled?: boolean;
  preset?: ColorPresetId;
  /** 0–200, 100 = recipe baseline (same as L2). */
  intensityPercent?: number;
};

export const DEFAULT_COMPOSITION_COLOR_SETTINGS: CompositionColorSettings = {
  enabled: false,
  preset: "none",
  intensityPercent: 100,
};

export function parseCompositionColorSettings(
  raw: unknown
): CompositionColorSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_COMPOSITION_COLOR_SETTINGS };
  }
  const o = raw as CompositionColorSettings;
  return {
    enabled: o.enabled ?? false,
    preset: o.preset ?? "none",
    intensityPercent:
      typeof o.intensityPercent === "number" ? o.intensityPercent : 100,
  };
}
