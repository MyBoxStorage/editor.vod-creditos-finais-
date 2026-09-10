import { FineTuneControls } from "./FineTuneControls";
import type { ColorPresetUi, SpeedRampRow, ZoomKeyframeRow } from "../types";

type AdvancedOptionsProps = {
  speed: number;
  onSpeedPreviewChange: (value: number) => void;
  onSpeedCommit: (value: number) => void;
  speedRamp: SpeedRampRow[];
  colorPreset: ColorPresetUi;
  onColorPresetChange: (value: ColorPresetUi) => void;
  zoomKeyframes: ZoomKeyframeRow[];
  onZoomKeyframesChange: (keyframes: ZoomKeyframeRow[]) => void;
};

export function AdvancedOptions({
  speed,
  onSpeedPreviewChange,
  onSpeedCommit,
  speedRamp,
  colorPreset,
  onColorPresetChange,
  zoomKeyframes,
  onZoomKeyframesChange,
}: AdvancedOptionsProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        Ajustes aplicados ao trecho inteiro (sem preset de momento selecionado).
      </p>
      <FineTuneControls
        speed={speed}
        onSpeedPreviewChange={onSpeedPreviewChange}
        onSpeedCommit={onSpeedCommit}
        speedRamp={speedRamp}
        colorPreset={colorPreset}
        onColorPresetChange={onColorPresetChange}
        zoomKeyframes={zoomKeyframes}
        onZoomKeyframesChange={onZoomKeyframesChange}
      />
    </div>
  );
}
