"use client";

import {
  COLOR_PRESET_OPTIONS,
  type CompositionColorSettings,
} from "../../../../../../lib/compositionColorSettings";

type Props = {
  colorSettings: CompositionColorSettings;
  onColorSettingsChange: (settings: CompositionColorSettings) => void;
};

export function CorTab({ colorSettings, onColorSettingsChange }: Props) {
  const update = (patch: Partial<CompositionColorSettings>) => {
    onColorSettingsChange({ ...colorSettings, ...patch });
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={colorSettings.enabled ?? false}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded border-zinc-600"
        />
        aplicar color grade geral ao clipe
      </label>

      <label className="block text-sm">
        preset
        <select
          value={colorSettings.preset ?? "none"}
          disabled={!colorSettings.enabled}
          onChange={(e) =>
            update({
              preset: e.target.value as CompositionColorSettings["preset"],
            })
          }
          className="mt-1 block rounded border border-zinc-700 bg-zinc-950 px-2 py-1 disabled:opacity-40"
        >
          {COLOR_PRESET_OPTIONS.filter((o) => o.id !== "none").map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        intensidade ({colorSettings.intensityPercent ?? 100}%)
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          disabled={!colorSettings.enabled}
          value={colorSettings.intensityPercent ?? 100}
          onChange={(e) =>
            update({ intensityPercent: Number(e.target.value) })
          }
          className="mt-2 block w-full max-w-xs disabled:opacity-40"
        />
      </label>

      <p className="text-xs text-zinc-500">
        Aplicado na mesma passagem, depois dos presets de momento por trecho e
        antes das legendas queimadas. Presets de momento continuam no trecho;
        o grade geral uniformiza o clipe inteiro por cima.
      </p>
    </div>
  );
}
