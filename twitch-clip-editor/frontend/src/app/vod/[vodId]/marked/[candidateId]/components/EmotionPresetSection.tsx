import type { RefObject } from "react";
import { useEffect, useState } from "react";
import {
  EMOTION_PRESET_META,
  type EmotionPresetId,
} from "../../../../../../lib/emotionPresets";
import type { EffectLibraryCard } from "../../../../../../lib/api";
import { browseEffectLibrary } from "../../../../../../lib/api";
import { LibraryBrowser } from "../../../../../../components/library/LibraryBrowser";
import { LibraryPreviewProvider } from "../../../../../../components/library/useLibraryPreview";
import type { ColorPresetUi, SpeedRampRow, ZoomKeyframeRow } from "../types";
import { formatTime } from "../utils";
import {
  applicationEnd,
  presetLabel,
  sortApplications,
  type PresetApplication,
} from "../presetApplications";
import { FineTuneControls } from "./FineTuneControls";
import { SectionFeedback } from "./SectionFeedback";

type EmotionPresetSectionProps = {
  busy: boolean;
  presetPreviewLoading: boolean;
  applications: PresetApplication[];
  selectedApplicationId: string | null;
  onSelectEmotionPreset: (presetId: EmotionPresetId) => void;
  onSelectApplication: (id: string) => void;
  onRemoveApplication: (id: string) => void;
  onUpdateApplication: (
    id: string,
    patch: Partial<PresetApplication>
  ) => void;
  onToggleLibraryItem: (
    applicationId: string,
    item: EffectLibraryCard,
    checked: boolean
  ) => void;
  clipDuration: number;
  onGeneratePresetPreview: () => void;
  presetSummary: string;
  presetPreviewCached: boolean;
  presetPreviewUrl: string | null;
  presetPreviewVideoRef: RefObject<HTMLVideoElement | null>;
  onEmotionIntensityCommit: (applicationId: string, value: number) => void;
  onSpeedCommit: (applicationId: string, value: number) => void;
  getPlayheadTime: () => number;
  status?: string;
  error?: string;
};

export function EmotionPresetSection({
  busy,
  presetPreviewLoading,
  applications,
  selectedApplicationId,
  onSelectEmotionPreset,
  onSelectApplication,
  onRemoveApplication,
  onUpdateApplication,
  onToggleLibraryItem,
  clipDuration,
  onGeneratePresetPreview,
  presetSummary,
  presetPreviewCached,
  presetPreviewUrl,
  presetPreviewVideoRef,
  onEmotionIntensityCommit,
  onSpeedCommit,
  getPlayheadTime,
  status,
  error,
}: EmotionPresetSectionProps) {
  const sorted = sortApplications(applications);
  const selected = applications.find((a) => a.id === selectedApplicationId);

  return (
    <div className="space-y-2">
      <SectionFeedback status={status} error={error} />
      <h3 className="text-sm font-medium text-zinc-200">presets de momento</h3>
      <p className="text-xs text-zinc-500">
        Clique em um preset para aplicar no playhead (atalhos 1–6). Cada clique
        adiciona uma aplicação — ajuste início, duração e intensidade depois.
      </p>
      <div className="flex flex-wrap gap-2">
        {EMOTION_PRESET_META.map((p, index) => (
          <button
            key={p.id}
            type="button"
            disabled={busy || presetPreviewLoading}
            onClick={() => onSelectEmotionPreset(p.id)}
            className="inline-flex items-center gap-2 rounded border border-zinc-600 bg-zinc-950 px-3 py-2 text-sm hover:border-amber-500 hover:bg-zinc-900 disabled:opacity-50"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-[10px] font-semibold uppercase text-amber-200">
              {index + 1}
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800/60 text-[10px] font-semibold uppercase text-zinc-400">
              {p.mark}
            </span>
            {p.label}
          </button>
        ))}
      </div>

      {sorted.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            aplicações neste trecho ({sorted.length})
          </h4>
          <ul className="space-y-1">
            {sorted.map((app) => {
              const expanded = app.id === selectedApplicationId;
              const end = applicationEnd(app);
              return (
                <li
                  key={app.id}
                  className={`rounded border ${
                    expanded
                      ? "border-amber-500/60 bg-amber-950/20"
                      : "border-zinc-800 bg-zinc-950/40"
                  }`}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-900/50"
                    onClick={() => onSelectApplication(app.id)}
                  >
                    <span>
                      <span className="font-medium text-zinc-100">
                        {presetLabel(app.presetId)}
                      </span>
                      <span className="ml-2 font-mono text-xs text-zinc-400">
                        {formatTime(app.inicio)}–{formatTime(end)}
                      </span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {expanded && (
                    <ApplicationEditor
                      app={app}
                      clipDuration={clipDuration}
                      busy={busy}
                      onUpdate={(patch) => onUpdateApplication(app.id, patch)}
                      onRemove={() => onRemoveApplication(app.id)}
                      onToggleLibraryItem={(item, checked) =>
                        onToggleLibraryItem(app.id, item, checked)
                      }
                      onEmotionIntensityCommit={(v) =>
                        onEmotionIntensityCommit(app.id, v)
                      }
                      onSpeedCommit={(v) => onSpeedCommit(app.id, v)}
                      getPlayheadTime={getPlayheadTime}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected && (
        <button
          type="button"
          disabled={busy || presetPreviewLoading}
          onClick={onGeneratePresetPreview}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          gerar prévia
        </button>
      )}

      {presetPreviewLoading && (
        <p className="flex items-center gap-2 rounded border border-sky-900/60 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          Renderizando prévia com ffmpeg…
        </p>
      )}
      {presetSummary && !presetPreviewLoading && (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          {presetSummary}
          {presetPreviewCached ? " · servido do cache" : ""}
        </p>
      )}
      {presetPreviewUrl && !presetPreviewLoading && (
        <div className="space-y-1 rounded border border-sky-800/60 bg-sky-950/20 p-3">
          <p className="text-xs font-medium text-sky-200">
            Prévia exata do preset (ffmpeg)
          </p>
          <video
            key={presetPreviewUrl}
            ref={presetPreviewVideoRef}
            src={presetPreviewUrl}
            controls
            className="max-h-64 w-full rounded bg-black"
          />
        </div>
      )}
    </div>
  );
}

function ApplicationEditor({
  app,
  clipDuration,
  busy,
  onUpdate,
  onRemove,
  onToggleLibraryItem,
  onEmotionIntensityCommit,
  onSpeedCommit,
  getPlayheadTime,
}: {
  app: PresetApplication;
  clipDuration: number;
  busy: boolean;
  onUpdate: (patch: Partial<PresetApplication>) => void;
  onRemove: () => void;
  onToggleLibraryItem: (item: EffectLibraryCard, checked: boolean) => void;
  onEmotionIntensityCommit: (value: number) => void;
  onSpeedCommit: (value: number) => void;
  getPlayheadTime: () => number;
}) {
  const end = applicationEnd(app);
  const [missingSuggested, setMissingSuggested] = useState(false);

  useEffect(() => {
    if (app.presetId !== "wasted") {
      setMissingSuggested(false);
      return;
    }
    void browseEffectLibrary({ search: "wasted", limit: 5 }).then((r) => {
      setMissingSuggested(r.items.length === 0);
    });
  }, [app.presetId]);

  return (
    <div className="space-y-3 border-t border-zinc-800 px-3 pb-3 pt-2">
      {app.presetId === "wasted" ? (
        <p className="text-xs text-zinc-400">
        Wasted aplica câmera lenta, dessaturação e shake no intervalo
        marcado, sem alongar o trecho. Relativo ao clipe, 0–
          {formatTime(clipDuration)}.
        </p>
      ) : (
        <p className="text-xs text-zinc-400">
          Intervalo do efeito (relativo ao clipe, 0–{formatTime(clipDuration)})
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          início
          <input
            type="text"
            inputMode="text"
            value={formatTime(app.inicio)}
            readOnly
            className="mt-1 block w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-400"
          />
        </label>
        <label className="text-sm">
          {app.presetId === "wasted" ? "duração" : "fim"}
          <input
            type="text"
            inputMode="text"
            value={
              app.presetId === "wasted"
                ? formatTime(app.duracao)
                : formatTime(end)
            }
            readOnly
            className="mt-1 block w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-zinc-400"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const t = Number(
              Math.max(0, Math.min(getPlayheadTime(), clipDuration)).toFixed(3)
            );
            onUpdate({ inicio: t });
          }}
          className="rounded border border-zinc-600 px-2 py-1 text-xs hover:border-zinc-400"
        >
          início = playhead
        </button>
      </div>

      <label className="block text-sm">
        intensidade ({app.intensidade}%)
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={app.intensidade}
          onChange={(e) =>
            onUpdate({ intensidade: Number(e.target.value) })
          }
          onPointerUp={(e) =>
            onEmotionIntensityCommit(
              Number((e.target as HTMLInputElement).value)
            )
          }
          className="mt-2 block w-full max-w-md"
        />
      </label>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <h4 className="text-sm font-medium text-zinc-200">
          ajuste fino deste momento
        </h4>
        <FineTuneControls
          speed={app.speedRamp.length > 0 ? 1 : 1}
          onSpeedPreviewChange={() => undefined}
          onSpeedCommit={onSpeedCommit}
          speedRamp={app.speedRamp}
          colorPreset={app.colorPreset}
          onColorPresetChange={(v) => onUpdate({ colorPreset: v })}
          zoomKeyframes={app.zoomKeyframes}
          onZoomKeyframesChange={(k) => onUpdate({ zoomKeyframes: k })}
          speedControlledByPreset={app.speedRamp.length > 0}
        />
      </div>

      <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950/60 p-3">
        <h4 className="text-sm font-medium text-zinc-200">
          somar à biblioteca
        </h4>
        {missingSuggested && app.presetId === "wasted" && (
          <p className="text-xs text-amber-200/80">
            Itens sugeridos do Wasted ainda não foram enviados à biblioteca.
            Marque qualquer outro item abaixo.
          </p>
        )}
        <LibraryPreviewProvider>
          <LibraryBrowser
            density="compact"
            mode="checkbox"
            checkedIds={new Set(app.itensBiblioteca)}
            disabled={busy}
            gridHeightClass="h-[220px]"
            showSections={false}
            onToggleCheck={(item, checked) =>
              onToggleLibraryItem(item, checked)
            }
          />
        </LibraryPreviewProvider>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        className="text-xs text-red-400 underline hover:text-red-300"
      >
        remover esta aplicação
      </button>
    </div>
  );
}
