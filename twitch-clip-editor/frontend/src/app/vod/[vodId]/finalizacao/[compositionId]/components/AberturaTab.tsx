"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOOK_RESEARCH_NOTE,
  MAX_HOOK_SEC,
  hookDurationSec,
  normalizeHookRange,
  type CompositionOpeningSettings,
} from "../../../../../../lib/compositionOpeningSettings";
import { formatClipTime } from "../../../../../../lib/finalizationTime";
import type { CompositionSegmentView } from "./SequenceTimeline";
import { LoopPanel } from "./LoopPanel";

type Props = {
  openingSettings: CompositionOpeningSettings;
  onOpeningSettingsChange: (settings: CompositionOpeningSettings) => void;
  segments: CompositionSegmentView[];
  contentDuration: number;
  segmentVideoSrc: (seg: CompositionSegmentView) => string | null;
  onReorder: (clipSegmentIds: string[]) => void;
  hookMarkingActive: boolean;
  onHookMarkingActiveChange: (active: boolean) => void;
  loopEnabled: boolean;
  onLoopEnabledChange: (enabled: boolean) => void;
  onTrimLastSegment: (trimSec: number) => Promise<void>;
  closingEnabled: boolean;
};

export function AberturaTab({
  openingSettings,
  onOpeningSettingsChange,
  segments,
  contentDuration,
  segmentVideoSrc,
  onReorder,
  hookMarkingActive,
  onHookMarkingActiveChange,
  loopEnabled,
  onLoopEnabledChange,
  onTrimLastSegment,
  closingEnabled,
}: Props) {
  const firstFrameRef = useRef<HTMLVideoElement>(null);
  const [hookWarning, setHookWarning] = useState<string | null>(null);

  const firstSeg = segments[0];
  const firstSrc = firstSeg ? segmentVideoSrc(firstSeg) : null;
  const hookDur = hookDurationSec(openingSettings);
  const isHookMode = openingSettings.mode === "hook";

  useEffect(() => {
    const v = firstFrameRef.current;
    if (v && firstSrc) {
      v.src = firstSrc;
      v.currentTime = 0;
    }
  }, [firstSrc]);

  const setMode = useCallback(
    (mode: "none" | "hook") => {
      if (mode === "none") {
        onOpeningSettingsChange({
          ...openingSettings,
          mode: "none",
          hookEnabled: false,
        });
        onHookMarkingActiveChange(false);
      } else {
        onOpeningSettingsChange({
          ...openingSettings,
          mode: "hook",
          hookEnabled: openingSettings.hookStartSec != null,
        });
      }
    },
    [onHookMarkingActiveChange, onOpeningSettingsChange, openingSettings]
  );

  const toggleHookEnabled = useCallback(
    (enabled: boolean) => {
      onOpeningSettingsChange({
        ...openingSettings,
        mode: "hook",
        hookEnabled: enabled,
      });
      if (enabled) onHookMarkingActiveChange(false);
    },
    [onHookMarkingActiveChange, onOpeningSettingsChange, openingSettings]
  );

  const moveSegmentToFront = useCallback(
    (index: number) => {
      if (index <= 0 || index >= segments.length) return;
      const ids = segments.map((s) => s.clipSegment.id);
      const [moved] = ids.splice(index, 1);
      ids.unshift(moved);
      onReorder(ids);
    },
    [onReorder, segments]
  );

  const applyHookRange = useCallback(
    (start: number, end: number) => {
      const draft: CompositionOpeningSettings = {
        ...openingSettings,
        mode: "hook",
        hookEnabled: true,
        hookStartSec: start,
        hookEndSec: end,
      };
      const { settings, warnings } = normalizeHookRange(draft, contentDuration);
      setHookWarning(warnings[0] ?? null);
      onOpeningSettingsChange(settings);
    },
    [contentDuration, onOpeningSettingsChange, openingSettings]
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs font-medium text-zinc-400">modo de abertura</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("none")}
            className={`rounded border px-3 py-1.5 text-xs ${
              !isHookMode
                ? "border-sky-500 bg-sky-900/40 text-sky-100"
                : "border-zinc-700 text-zinc-400"
            }`}
          >
            A — cold open (padrão)
          </button>
          <button
            type="button"
            onClick={() => setMode("hook")}
            className={`rounded border px-3 py-1.5 text-xs ${
              isHookMode
                ? "border-fuchsia-500 bg-fuchsia-900/40 text-fuchsia-100"
                : "border-zinc-700 text-zinc-400"
            }`}
          >
            B — hook do clipe
          </button>
        </div>
      </div>

      {!isHookMode && (
        <div className="space-y-3">
          <div className="mx-auto max-w-xs">
            <video
              ref={firstFrameRef}
              muted
              playsInline
              className="aspect-[9/16] w-full rounded border border-zinc-700 bg-black object-cover"
            />
          </div>
          <p className="text-center text-sm text-zinc-200">
            isso prende em 1 segundo?
          </p>
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">reordenar — trazer trecho forte para a frente:</p>
            <div className="flex flex-wrap gap-2">
              {segments.map((s, i) =>
                i === 0 ? null : (
                  <button
                    key={s.clipSegment.id}
                    type="button"
                    onClick={() => moveSegmentToFront(i)}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    #{i + 1} → início
                  </button>
                )
              )}
            </div>
            <p className="text-[10px] text-zinc-600">
              Ou arraste na sequência abaixo para reordenar.
            </p>
          </div>
        </div>
      )}

      {isHookMode && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={openingSettings.hookEnabled ?? false}
              onChange={(e) => toggleHookEnabled(e.target.checked)}
            />
            aplicar hook na exportação
          </label>

          {openingSettings.hookStartSec != null &&
            openingSettings.hookEndSec != null && (
              <p className="text-xs text-zinc-400">
                marcação: {formatClipTime(openingSettings.hookStartSec)} –{" "}
                {formatClipTime(openingSettings.hookEndSec)} (
                {formatClipTime(hookDur)})
                {!openingSettings.hookEnabled && " · guardada, desligada"}
              </p>
            )}

          <button
            type="button"
            onClick={() =>
              onHookMarkingActiveChange(!hookMarkingActive)
            }
            className={`rounded border px-3 py-2 text-xs ${
              hookMarkingActive
                ? "border-amber-500 bg-amber-900/40 text-amber-100"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {hookMarkingActive
              ? "marcando… arraste na sequência abaixo"
              : "marcar trecho na sequência (até 2s)"}
          </button>

          {hookWarning && (
            <div className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              {hookWarning}
            </div>
          )}

          <p className="text-[10px] text-zinc-600">
            Máx. recomendado {MAX_HOOK_SEC}s. Acima disso avisa, não bloqueia.{" "}
            {HOOK_RESEARCH_NOTE}
          </p>
        </div>
      )}

      <LoopPanel
        segments={segments}
        totalDuration={contentDuration}
        segmentVideoSrc={segmentVideoSrc}
        loopEnabled={loopEnabled}
        onLoopEnabledChange={onLoopEnabledChange}
        onTrimLastSegment={onTrimLastSegment}
        closingEnabled={closingEnabled}
      />
    </div>
  );
}