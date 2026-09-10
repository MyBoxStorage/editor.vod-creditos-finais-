export type ColorPresetId =
  | "none"
  | "vivid"
  | "vivid_contrast"
  | "cold_desaturated"
  | "wasted_grayscale";

export type CompositionColorSettings = {
  enabled?: boolean;
  preset?: ColorPresetId;
  intensityPercent?: number;
};

export const DEFAULT_COMPOSITION_COLOR_SETTINGS: CompositionColorSettings = {
  enabled: false,
  preset: "none",
  intensityPercent: 100,
};

export const COLOR_PRESET_OPTIONS: Array<{
  id: ColorPresetId;
  label: string;
}> = [
  { id: "none", label: "Nenhum" },
  { id: "vivid", label: "Vívido" },
  { id: "vivid_contrast", label: "Vívido contraste" },
  { id: "cold_desaturated", label: "Frio dessaturado" },
  { id: "wasted_grayscale", label: "Wasted (P&B)" },
];

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
