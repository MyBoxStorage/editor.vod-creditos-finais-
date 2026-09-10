export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Height fractions of the output frame for split layouts (must sum to 1). */
export type SplitPanelRatios = {
  webcam: number;
  gameplay: number;
};

export type LayoutPreset = {
  id: string;
  name: string;
  gameplayCrop: CropRect;
  webcamCrop: CropRect;
  outputResolution: { w: number; h: number };
  orientation: "vertical" | "horizontal";
  /** When false, only gameplayCrop is used (no webcam split). */
  split: boolean;
  /** Required when split=true — panel height ratios of the output frame. */
  splitPanelRatios?: SplitPanelRatios;
};

/**
 * Layout presets. vertical-split-9x16 uses real OBS crop coords (1920x1080 canvas).
 * gameplayCrop excludes the webcam region so the cam is not duplicated in the stack.
 */
export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "vertical-split-9x16",
    name: "Vertical 9:16 (webcam em cima, gameplay embaixo)",
    orientation: "vertical",
    split: true,
    outputResolution: { w: 1080, h: 1920 },
    // StreamLadder-style: webcam ~30% top, gameplay ~70% bottom
    splitPanelRatios: { webcam: 0.3, gameplay: 0.7 },
    // OBS: webcam bottom-right — gameplay is only the region above it
    gameplayCrop: { x: 0, y: 0, w: 1920, h: 805 },
    webcamCrop: { x: 1433, y: 806, w: 487, h: 274 },
  },
  {
    id: "horizontal-16x9",
    name: "Horizontal 16:9 (sem split) [PLACEHOLDER]",
    orientation: "horizontal",
    split: false,
    outputResolution: { w: 1920, h: 1080 },
    gameplayCrop: { x: 0, y: 0, w: 1920, h: 1080 },
    webcamCrop: { x: 0, y: 0, w: 0, h: 0 },
  },
];

export function getLayoutPreset(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}

export function listLayoutPresets(): LayoutPreset[] {
  return LAYOUT_PRESETS;
}
