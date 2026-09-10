"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  SUBTITLE_STYLE_OPTIONS,
  type SubtitleSettings,
} from "../../../../../../lib/animatedSubtitle";
import {
  buildRemappedSubtitleSegments,
  remapCompositionSubtitleWords,
  type CompositionSegmentSubtitleInput,
} from "../../../../../../lib/compositionSubtitleRemap";
import { CorTab } from "./CorTab";
import { EmendasTab } from "./EmendasTab";
import { AberturaTab } from "./AberturaTab";
import { FechamentoTab } from "./FechamentoTab";
import {
  parseCompositionColorSettings,
  type CompositionColorSettings,
} from "../../../../../../lib/compositionColorSettings";
import {
  parseCompositionJoinSettings,
  type CompositionJoinSettings,
} from "../../../../../../lib/compositionJoinSettings";
import {
  parseCompositionOpeningSettings,
  type CompositionOpeningSettings,
} from "../../../../../../lib/compositionOpeningSettings";
import {
  parseCompositionClosingSettings,
  type CompositionClosingSettings,
} from "../../../../../../lib/compositionClosingSettings";
import type { ClipSegment } from "../../../../../../lib/api";
import type { CompositionSegmentView } from "./SequenceTimeline";

export type FinishTabId =
  | "legendas"
  | "emendas"
  | "cor"
  | "abertura"
  | "fechamento";

const TABS: Array<{ id: FinishTabId; label: string }> = [
  { id: "legendas", label: "legendas" },
  { id: "emendas", label: "emendas" },
  { id: "cor", label: "cor" },
  { id: "abertura", label: "abertura" },
  { id: "fechamento", label: "fechamento" },
];

type FinishTabsProps = {
  vodId: string;
  activeTab: FinishTabId;
  onTabChange: (tab: FinishTabId) => void;
  subtitleSettings: SubtitleSettings;
  onSubtitleSettingsChange: (settings: SubtitleSettings) => void;
  joinSettings: CompositionJoinSettings;
  onJoinSettingsChange: (settings: CompositionJoinSettings) => void;
  colorSettings: CompositionColorSettings;
  onColorSettingsChange: (settings: CompositionColorSettings) => void;
  openingSettings: CompositionOpeningSettings;
  onOpeningSettingsChange: (settings: CompositionOpeningSettings) => void;
  closingSettings: CompositionClosingSettings;
  onClosingSettingsChange: (settings: CompositionClosingSettings) => void;
  segmentInputs: CompositionSegmentSubtitleInput[];
  joinTimes: number[];
  segments: Array<{ durationSec: number; timelineStart: number; clipSegment: ClipSegment }>;
  segmentViews: CompositionSegmentView[];
  contentDuration: number;
  segmentVideoSrc: (seg: CompositionSegmentView) => string | null;
  onReorder: (clipSegmentIds: string[]) => void;
  hookMarkingActive: boolean;
  onHookMarkingActiveChange: (active: boolean) => void;
  loopEnabled: boolean;
  onLoopEnabledChange: (enabled: boolean) => void;
  onTrimLastSegment: (trimSec: number) => Promise<void>;
  onJoinPreview: (joinIndex: number) => Promise<void>;
  joinPreviewLoading: number | null;
};

export function FinishTabs({
  vodId,
  activeTab,
  onTabChange,
  subtitleSettings,
  onSubtitleSettingsChange,
  joinSettings,
  onJoinSettingsChange,
  colorSettings,
  onColorSettingsChange,
  openingSettings,
  onOpeningSettingsChange,
  closingSettings,
  onClosingSettingsChange,
  segmentInputs,
  joinTimes,
  segments,
  segmentViews,
  contentDuration,
  segmentVideoSrc,
  onReorder,
  hookMarkingActive,
  onHookMarkingActiveChange,
  loopEnabled,
  onLoopEnabledChange,
  onTrimLastSegment,
  onJoinPreview,
  joinPreviewLoading,
}: FinishTabsProps) {
  const remappedWords = useMemo(
    () => remapCompositionSubtitleWords(segmentInputs),
    [segmentInputs]
  );
  const subtitleSegments = useMemo(
    () => buildRemappedSubtitleSegments(remappedWords, joinTimes),
    [remappedWords, joinTimes]
  );
  const crossingJoins = subtitleSegments.filter((s) => s.crossesJoin);
  const wordCount = remappedWords.length;

  const updateSettings = useCallback(
    (patch: Partial<SubtitleSettings>) => {
      onSubtitleSettingsChange({ ...subtitleSettings, ...patch });
    },
    [subtitleSettings, onSubtitleSettingsChange]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-zinc-800 bg-zinc-900/40">
      <div className="flex shrink-0 gap-1 border-b border-zinc-800 p-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "legendas" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-400">estilo</p>
              <div className="flex flex-wrap gap-2">
                {SUBTITLE_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateSettings({ style: opt.id })}
                    className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                      subtitleSettings.style === opt.id
                        ? "border-violet-500 bg-violet-900/50 text-violet-100"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="text-xs text-zinc-400">cor de destaque</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={subtitleSettings.highlightColor}
                  onChange={(e) =>
                    updateSettings({ highlightColor: e.target.value })
                  }
                  className="h-8 w-12 cursor-pointer rounded border border-zinc-700 bg-zinc-950"
                />
                <span className="font-mono text-xs text-zinc-500">
                  {subtitleSettings.highlightColor}
                </span>
              </div>
            </label>

            <div className="space-y-1 text-sm">
              <p className="text-zinc-300">
                {wordCount} palavra{wordCount !== 1 ? "s" : ""} na composição
              </p>
              <p className="text-xs text-zinc-500">
                Edite o texto e timing em cada trecho (camada 2):
              </p>
              <ul className="space-y-1">
                {segments.map((s, i) => (
                  <li key={s.clipSegment.id}>
                    <Link
                      href={`/vod/${vodId}/marked/${s.clipSegment.id}`}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      trecho {i + 1} → editor L2
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {crossingJoins.length > 0 && (
              <div className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                <p className="font-medium">Aviso: legenda cruza emenda</p>
                <p className="mt-1 text-xs text-amber-200/80">
                  {crossingJoins.length} segmento(s) de legenda atravessam a
                  junção entre trechos. Considere ajustar o texto ou o corte.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "emendas" && (
          <EmendasTab
            joinSettings={joinSettings}
            onJoinSettingsChange={onJoinSettingsChange}
            joinTimes={joinTimes}
            segments={segments}
            onJoinPreview={onJoinPreview}
            joinPreviewLoading={joinPreviewLoading}
          />
        )}

        {activeTab === "cor" && (
          <CorTab
            colorSettings={colorSettings}
            onColorSettingsChange={onColorSettingsChange}
          />
        )}

        {activeTab === "abertura" && (
          <AberturaTab
            openingSettings={openingSettings}
            onOpeningSettingsChange={onOpeningSettingsChange}
            segments={segmentViews}
            contentDuration={contentDuration}
            segmentVideoSrc={segmentVideoSrc}
            onReorder={onReorder}
            hookMarkingActive={hookMarkingActive}
            onHookMarkingActiveChange={onHookMarkingActiveChange}
            loopEnabled={loopEnabled}
            onLoopEnabledChange={onLoopEnabledChange}
            onTrimLastSegment={onTrimLastSegment}
            closingEnabled={closingSettings.enabled ?? false}
          />
        )}
        {activeTab === "fechamento" && (
          <FechamentoTab
            closingSettings={closingSettings}
            onClosingSettingsChange={onClosingSettingsChange}
            loopEnabled={loopEnabled}
          />
        )}
      </div>
    </div>
  );
}

export function parseCompositionJoinSettingsFromJson(
  raw: unknown
): CompositionJoinSettings {
  return parseCompositionJoinSettings(raw);
}

export function parseCompositionColorSettingsFromJson(
  raw: unknown
): CompositionColorSettings {
  return parseCompositionColorSettings(raw);
}

export function parseCompositionOpeningSettingsFromJson(
  raw: unknown
): CompositionOpeningSettings {
  return parseCompositionOpeningSettings(raw);
}

export function parseCompositionClosingSettingsFromJson(
  raw: unknown
): CompositionClosingSettings {
  return parseCompositionClosingSettings(raw);
}

export function parseSubtitleSettings(raw: unknown): SubtitleSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SUBTITLE_SETTINGS };
  const o = raw as Partial<SubtitleSettings>;
  return {
    ...DEFAULT_SUBTITLE_SETTINGS,
    ...o,
    style: o.style ?? DEFAULT_SUBTITLE_SETTINGS.style,
    highlightColor:
      o.highlightColor ?? DEFAULT_SUBTITLE_SETTINGS.highlightColor,
  };
}
