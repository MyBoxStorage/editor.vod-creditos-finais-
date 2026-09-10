import type { EmotionSpeedRampPoint } from "../../../../../lib/emotionPresets";

export type Props = {
  params: Promise<{ vodId: string; candidateId: string }>;
};

export type EditKind = "candidate" | "clip_segment";

export type DragHandle = "start" | "end" | null;

export type ZoomKeyframeRow = {
  time: number;
  scale: number;
  x: number;
  y: number;
};

export type ColorPresetUi =
  | "none"
  | "vivid"
  | "vivid_contrast"
  | "cold_desaturated"
  | "wasted_grayscale";

export type SpeedRampRow = EmotionSpeedRampPoint;

export type EditorTabId =
  | "cortar"
  | "legendas"
  | "momentos"
  | "efeitos"
  | "ajuste_fino";

export type SectionMessage = {
  status: string;
  error: string;
};

export type SectionKey = EditorTabId | "acoes";
