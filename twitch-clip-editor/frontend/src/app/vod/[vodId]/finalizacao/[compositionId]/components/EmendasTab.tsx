"use client";

import { useCallback, useMemo } from "react";
import type { UnifiedExportSegmentInput } from "../../../../../../lib/api";
import type { SubtitleSettings } from "../../../../../../lib/animatedSubtitle";
import type { CompositionColorSettings } from "../../../../../../lib/compositionColorSettings";
import {
  DEFAULT_JOIN_OVERLAP_SEC,
  ensureJoinRows,
  JOIN_AUDIO_MODE_LABELS,
  JOIN_VIDEO_TRANSITION_LABELS,
  MAX_VIDEO_TRANSITION_SEC,
  type CompositionJoinSettings,
  type JoinAudioMode,
  type JoinSetting,
  type JoinVideoTransition,
} from "../../../../../../lib/compositionJoinSettings";
import type { CompositionSegmentSubtitleInput } from "../../../../../../lib/compositionSubtitleRemap";
import { computeRhythmMetrics } from "../../../../../../lib/compositionRhythm";
import { formatClipTime } from "../../../../../../lib/finalizationTime";
import type { ClipSegment } from "../../../../../../lib/api";

type SegmentView = {
  durationSec: number;
  timelineStart: number;
  clipSegment: ClipSegment;
};

type Props = {
  joinSettings: CompositionJoinSettings;
  onJoinSettingsChange: (settings: CompositionJoinSettings) => void;
  joinTimes: number[];
  segments: SegmentView[];
  onJoinPreview: (joinIndex: number) => Promise<void>;
  joinPreviewLoading: number | null;
};

const AUDIO_MODES: JoinAudioMode[] = ["cross", "j-cut", "l-cut", "hard"];
const VIDEO_TRANSITIONS: JoinVideoTransition[] = ["cut", "fade", "dissolve"];

function resolvedJoinRow(
  settings: CompositionJoinSettings,
  index: number
): JoinSetting {
  return settings.joins?.[index] ?? {};
}

export function EmendasTab({
  joinSettings,
  onJoinSettingsChange,
  joinTimes,
  segments,
  onJoinPreview,
  joinPreviewLoading,
}: Props) {
  const joinCount = Math.max(0, segments.length - 1);
  const settings = useMemo(
    () => ensureJoinRows(joinSettings, joinCount),
    [joinSettings, joinCount]
  );

  const rhythm = useMemo(
    () => computeRhythmMetrics(segments, joinTimes),
    [segments, joinTimes]
  );

  const updateGlobal = useCallback(
    (patch: Partial<CompositionJoinSettings>) => {
      onJoinSettingsChange({ ...settings, ...patch });
    },
    [onJoinSettingsChange, settings]
  );

  const updateJoin = useCallback(
    (index: number, patch: Partial<JoinSetting>) => {
      const joins = [...(settings.joins ?? [])];
      joins[index] = { ...joins[index], ...patch };
      onJoinSettingsChange({ ...settings, joins });
    },
    [onJoinSettingsChange, settings]
  );

  const applyRowToAll = useCallback(
    (index: number) => {
      const row = resolvedJoinRow(settings, index);
      const joins = (settings.joins ?? []).map(() => ({ ...row }));
      onJoinSettingsChange({ ...settings, joins });
    },
    [onJoinSettingsChange, settings]
  );

  if (joinCount === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Adicione pelo menos dois trechos para configurar emendas.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="text-xs font-medium text-zinc-400">padrões globais</p>
        <div className="mt-2 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            sobreposição padrão (s)
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={settings.defaultOverlapSec ?? DEFAULT_JOIN_OVERLAP_SEC}
              onChange={(e) =>
                updateGlobal({
                  defaultOverlapSec: Number(e.target.value),
                })
              }
              className="mt-1 block w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            áudio padrão
            <select
              value={settings.defaultAudioMode ?? "cross"}
              onChange={(e) =>
                updateGlobal({
                  defaultAudioMode: e.target.value as JoinAudioMode,
                })
              }
              className="mt-1 block rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            >
              {AUDIO_MODES.map((m) => (
                <option key={m} value={m}>
                  {JOIN_AUDIO_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Padrão: vídeo corte seco + áudio cruzado ({DEFAULT_JOIN_OVERLAP_SEC}s).
          Sobreposição usa material original adjacente ao trecho.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-400">
          emendas ({joinCount})
        </p>
        <ul className="space-y-2">
          {joinTimes.map((time, index) => {
            const row = resolvedJoinRow(settings, index);
            const audioMode =
              row.audioMode ?? settings.defaultAudioMode ?? "cross";
            const overlap =
              row.overlapSec ??
              settings.defaultOverlapSec ??
              DEFAULT_JOIN_OVERLAP_SEC;
            const videoTransition = row.videoTransition ?? "cut";
            const videoSec =
              row.videoTransitionSec ?? (videoTransition === "cut" ? 0 : 0.2);
            const transitionWarn = videoSec > MAX_VIDEO_TRANSITION_SEC + 0.001;

            return (
              <li
                key={index}
                className="rounded border border-zinc-800 bg-zinc-950/30 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    emenda {index + 1} · {formatClipTime(time)}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={joinPreviewLoading !== null}
                      onClick={() => void onJoinPreview(index)}
                      className="rounded border border-sky-700 px-2 py-1 text-xs text-sky-300 hover:bg-sky-950/50 disabled:opacity-50"
                    >
                      {joinPreviewLoading === index ? "ouvindo…" : "ouvir ±2s"}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyRowToAll(index)}
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                    >
                      aplicar a todas
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-xs">
                    modo áudio
                    <select
                      value={audioMode}
                      onChange={(e) =>
                        updateJoin(index, {
                          audioMode: e.target.value as JoinAudioMode,
                        })
                      }
                      className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    >
                      {AUDIO_MODES.map((m) => (
                        <option key={m} value={m}>
                          {JOIN_AUDIO_MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    sobreposição (s)
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.05}
                      disabled={audioMode === "hard"}
                      value={overlap}
                      onChange={(e) =>
                        updateJoin(index, { overlapSec: Number(e.target.value) })
                      }
                      className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm disabled:opacity-40"
                    />
                  </label>
                  <label className="text-xs">
                    transição vídeo
                    <select
                      value={videoTransition}
                      onChange={(e) =>
                        updateJoin(index, {
                          videoTransition: e.target.value as JoinVideoTransition,
                          videoTransitionSec:
                            e.target.value === "cut" ? 0 : videoSec || 0.2,
                        })
                      }
                      className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                    >
                      {VIDEO_TRANSITIONS.map((t) => (
                        <option key={t} value={t}>
                          {JOIN_VIDEO_TRANSITION_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    duração vídeo (s)
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.05}
                      disabled={videoTransition === "cut"}
                      value={videoSec}
                      onChange={(e) =>
                        updateJoin(index, {
                          videoTransitionSec: Number(e.target.value),
                        })
                      }
                      className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm disabled:opacity-40"
                    />
                  </label>
                </div>

                {transitionWarn && (
                  <p className="mt-2 text-xs text-amber-300">
                    Transição acima de {MAX_VIDEO_TRANSITION_SEC}s prejudica o
                    ritmo — será limitada no export.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="text-xs font-medium text-zinc-400">ritmo do clipe</p>
        <p className="mt-1 text-sm text-zinc-300">
          {rhythm.averageGapSec != null
            ? `Média entre mudanças visuais: ${rhythm.averageGapSec}s (${rhythm.visualChangeCount} mudanças)`
            : "Sem dados de ritmo"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Meta: mudança visual a cada 1,5–2s em clipes abaixo de 60s. Informativo
          — nada é bloqueado.
        </p>
        {rhythm.staleSpans.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
            {rhythm.staleSpans.map((span, i) => (
              <li key={i}>
                Trecho parado {formatClipTime(span.startSec)}–
                {formatClipTime(span.endSec)} ({span.durationSec}s) · trecho{" "}
                {span.segmentIndex + 1}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
