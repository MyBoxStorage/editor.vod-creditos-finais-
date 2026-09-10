import { useEffect, useState } from "react";
import type { ColorPresetUi, SpeedRampRow, ZoomKeyframeRow } from "../types";
import { formatTime } from "../utils";
import { onTimeFieldBlur, onTimeFieldChange } from "../timeField";

function ZoomTimeField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(formatTime(value));
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatTime(value));
      setInvalid(false);
    }
  }, [value, focused]);

  return (
    <label className="text-xs text-zinc-400">
      em
      <input
        type="text"
        inputMode="text"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) =>
          onTimeFieldChange(e.target.value, setText, setInvalid, (next) => {
            onCommit(Number(next.toFixed(3)));
          })
        }
        onBlur={() => {
          setFocused(false);
          onTimeFieldBlur(text, value, setText, setInvalid);
        }}
        className="mt-1 block w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm font-mono"
      />
      {invalid && (
        <span className="ml-1 text-red-400">hora inválida</span>
      )}
    </label>
  );
}

export type FineTuneControlsProps = {
  speed: number;
  onSpeedPreviewChange: (value: number) => void;
  onSpeedCommit: (value: number) => void;
  speedRamp: SpeedRampRow[];
  colorPreset: ColorPresetUi;
  onColorPresetChange: (value: ColorPresetUi) => void;
  zoomKeyframes: ZoomKeyframeRow[];
  onZoomKeyframesChange: (keyframes: ZoomKeyframeRow[]) => void;
  /** When true, speed slider is disabled because preset controls speed. */
  speedControlledByPreset?: boolean;
};

export function FineTuneControls({
  speed,
  onSpeedPreviewChange,
  onSpeedCommit,
  speedRamp,
  colorPreset,
  onColorPresetChange,
  zoomKeyframes,
  onZoomKeyframesChange,
  speedControlledByPreset = false,
}: FineTuneControlsProps) {
  const speedDisabled = speedControlledByPreset || speedRamp.length > 0;

  return (
    <div className="space-y-3 rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          velocidade ({speed.toFixed(2)}x)
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={speed}
            disabled={speedDisabled}
            onChange={(e) =>
              onSpeedPreviewChange(Number(e.target.value))
            }
            onPointerUp={(e) =>
              onSpeedCommit(Number((e.target as HTMLInputElement).value))
            }
            onKeyUp={(e) => {
              if (e.key === "Enter") {
                onSpeedCommit(Number((e.target as HTMLInputElement).value));
              }
            }}
            className="mt-2 block w-48 disabled:opacity-40"
          />
          {speedDisabled && (
            <span className="mt-1 block text-xs text-zinc-500">
              velocidade controlada pelo preset
            </span>
          )}
        </label>
        <label className="text-sm">
          cor
          <select
            value={colorPreset}
            onChange={(e) =>
              onColorPresetChange(e.target.value as ColorPresetUi)
            }
            className="mt-1 block rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
          >
            <option value="none">Nenhum</option>
            <option value="vivid">Vívido</option>
            <option value="vivid_contrast">Vívido contraste</option>
            <option value="cold_desaturated">Frio dessaturado</option>
            <option value="wasted_grayscale">Wasted (P&amp;B)</option>
          </select>
        </label>
      </div>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-200">zoom</h3>
            <p className="text-xs text-zinc-500">
              Tempo relativo ao clipe (0 = início do preview). Aproximação 1,0 =
              sem zoom. Horizontal/vertical em % do frame (50 = centro).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onZoomKeyframesChange([
                ...zoomKeyframes,
                { time: 0, scale: 1.0, x: 50, y: 50 },
              ])
            }
            className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
          >
            adicionar ponto de zoom
          </button>
        </div>
        {zoomKeyframes.length === 0 ? (
          <p className="text-xs text-zinc-500">
            Nenhum ponto — export sem zoom manual.
          </p>
        ) : (
          <ul className="space-y-2">
            {zoomKeyframes.map((kf, index) => (
              <li
                key={index}
                className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 bg-zinc-950/60 p-2"
              >
                <ZoomTimeField
                  value={kf.time}
                  onCommit={(time) => {
                    const next = [...zoomKeyframes];
                    next[index] = { ...next[index], time };
                    onZoomKeyframesChange(next);
                  }}
                />
                <label className="text-xs text-zinc-400">
                  aproximação
                  <input
                    type="number"
                    step={0.05}
                    min={0.1}
                    value={kf.scale}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = [...zoomKeyframes];
                      next[index] = { ...next[index], scale: value };
                      onZoomKeyframesChange(next);
                    }}
                    className="mt-1 block w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  horizontal
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={100}
                    value={kf.x}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = [...zoomKeyframes];
                      next[index] = { ...next[index], x: value };
                      onZoomKeyframesChange(next);
                    }}
                    className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  vertical
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={100}
                    value={kf.y}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = [...zoomKeyframes];
                      next[index] = { ...next[index], y: value };
                      onZoomKeyframesChange(next);
                    }}
                    className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onZoomKeyframesChange(
                      zoomKeyframes.filter((_, i) => i !== index)
                    )
                  }
                  className="rounded bg-zinc-800 px-2 py-1.5 text-xs hover:bg-zinc-700"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {speedRamp.length > 0 && (
        <p className="text-xs text-zinc-500">velocidade controlada pelo preset</p>
      )}
    </div>
  );
}
