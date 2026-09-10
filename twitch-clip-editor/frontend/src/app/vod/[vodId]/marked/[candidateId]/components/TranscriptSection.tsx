"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClipTranscript, GlossaryEntry, MarkedCandidate } from "../../../../../../lib/api";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  TIMING_STATUS_LABELS,
  tokenizeSegmentText,
  type SubtitleSettings,
  type SegmentTimingStatus,
} from "../../../../../../lib/animatedSubtitle";
import { formatTime } from "../utils";

function relativeSegmentTime(seconds: number): number {
  return Math.max(0, seconds);
}

type TranscriptSectionProps = {
  busy: boolean;
  onTranscribe: () => void;
  transcript: ClipTranscript | null;
  transcriptDirty: boolean;
  onSaveTranscript: () => void;
  candidate: MarkedCandidate | null;
  segmentTexts: string[];
  onSegmentTextChange: (index: number, value: string) => void;
  segmentHighlights: number[][];
  onToggleWordHighlight: (segmentIndex: number, wordIndex: number) => void;
  subtitleSettings: SubtitleSettings;
  onSubtitleSettingsChange: (settings: SubtitleSettings) => void;
  onResyncSegment: (index: number) => void;
  resyncingIndex: number | null;
  glossaryEntries: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => void;
  onSaveGlossary: () => void;
  onOfferGlossary: (from: string, to: string) => void;
  pendingGlossaryOffer: { from: string; to: string } | null;
  onDismissGlossaryOffer: () => void;
  useSubtitles: boolean;
  onUseSubtitlesChange: (checked: boolean) => void;
  subtitleFullClip: boolean;
  onSubtitleFullClip: () => void;
  onSubtitleSubset: () => void;
  clipDuration: number;
  subStartInput: string;
  subEndInput: string;
  subStartError: boolean;
  subEndError: boolean;
  onSubStartInputChange: (value: string) => void;
  onSubEndInputChange: (value: string) => void;
  onSubStartBlur: () => void;
  onSubEndBlur: () => void;
};

function SegmentWordEditor({
  text,
  highlights,
  highlightColor,
  onToggleWord,
  onTextChange,
}: {
  text: string;
  highlights: Set<number>;
  highlightColor: string;
  onToggleWord: (wordIndex: number) => void;
  onTextChange: (value: string) => void;
}) {
  const tokens = tokenizeSegmentText(text);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tokens.map((tok, wi) => {
          const on = highlights.has(wi);
          return (
            <button
              key={`${wi}-${tok}`}
              type="button"
              onClick={() => onToggleWord(wi)}
              className="rounded px-1.5 py-0.5 text-sm transition-colors"
              style={{
                color: on ? highlightColor : undefined,
                background: on ? `${highlightColor}22` : "rgba(255,255,255,0.06)",
                border: on
                  ? `1px solid ${highlightColor}`
                  : "1px solid rgba(255,255,255,0.1)",
              }}
              title="clique para alternar destaque de cor"
            >
              {tok}
            </button>
          );
        })}
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={2}
        className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
      />
    </div>
  );
}

export function TranscriptSection({
  busy,
  onTranscribe,
  transcript,
  transcriptDirty,
  onSaveTranscript,
  candidate,
  segmentTexts,
  onSegmentTextChange,
  segmentHighlights,
  onToggleWordHighlight,
  subtitleSettings,
  onSubtitleSettingsChange,
  onResyncSegment,
  resyncingIndex,
  glossaryEntries,
  onGlossaryChange,
  onSaveGlossary,
  onOfferGlossary,
  pendingGlossaryOffer,
  onDismissGlossaryOffer,
  useSubtitles,
  onUseSubtitlesChange,
  subtitleFullClip,
  onSubtitleFullClip,
  onSubtitleSubset,
  subStartInput,
  subEndInput,
  subStartError,
  subEndError,
  onSubStartInputChange,
  onSubEndInputChange,
  onSubStartBlur,
  onSubEndBlur,
}: TranscriptSectionProps) {
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const timingStatusFor = useCallback(
    (index: number): SegmentTimingStatus => {
      const seg = transcript?.segments[index];
      return seg?.timingStatus ?? "original";
    },
    [transcript]
  );

  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">legendas</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onTranscribe}
          className="rounded bg-violet-700 px-3 py-1.5 text-sm hover:bg-violet-600 disabled:opacity-50"
        >
          gerar legendas
        </button>
        {transcript && (
          <button
            type="button"
            disabled={busy || !transcriptDirty}
            onClick={onSaveTranscript}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50"
          >
            salvar correções
          </button>
        )}
        {(candidate?.isManuallyEdited || transcript?.isManuallyEdited) && (
          <span className="text-xs text-zinc-400">editado manualmente</span>
        )}
      </div>

      {transcript && (
        <div className="space-y-3 rounded border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="text-xs text-zinc-500">
            estilo de legenda — escolha na{" "}
            <span className="text-zinc-300">edição final</span> (camada 3)
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
            <label className="flex flex-col gap-1">
              folga após fala (s)
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={subtitleSettings.tailAfterSpeechSec}
                onChange={(e) =>
                  onSubtitleSettingsChange({
                    ...subtitleSettings,
                    tailAfterSpeechSec: Number(e.target.value) || 0,
                  })
                }
                className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
              />
            </label>
            <label className="flex flex-col gap-1">
              limiar para limpar tela (s)
              <input
                type="number"
                min={0}
                max={5}
                step={0.05}
                value={subtitleSettings.clearGapThresholdSec}
                onChange={(e) =>
                  onSubtitleSettingsChange({
                    ...subtitleSettings,
                    clearGapThresholdSec: Number(e.target.value) || 0,
                  })
                }
                className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-200"
              />
            </label>
            <span className="self-end text-zinc-600">
              intervalos maiores que o limiar deixam a tela sem legenda
            </span>
          </div>
        </div>
      )}

      {transcript && transcript.segments.length > 0 ? (
        <ul className="max-h-96 space-y-2 overflow-auto">
          {transcript.segments.map((seg, index) => (
            <li
              key={index}
              className="rounded border border-zinc-800 bg-zinc-950/80 p-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>#{index}</span>
                <span>
                  {formatTime(relativeSegmentTime(seg.start))} –{" "}
                  {formatTime(relativeSegmentTime(seg.end))}
                </span>
                <span className="text-zinc-600">
                  {TIMING_STATUS_LABELS[timingStatusFor(index)]}
                </span>
                <button
                  type="button"
                  disabled={busy || resyncingIndex === index}
                  onClick={() => onResyncSegment(index)}
                  className="ml-auto rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                >
                  {resyncingIndex === index
                    ? "re-sincronizando…"
                    : "re-sincronizar"}
                </button>
              </div>
              <SegmentWordEditor
                text={segmentTexts[index] ?? ""}
                highlights={new Set(segmentHighlights[index] ?? [])}
                highlightColor={subtitleSettings.highlightColor}
                onToggleWord={(wi) => onToggleWordHighlight(index, wi)}
                onTextChange={(v) => onSegmentTextChange(index, v)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          Sem segmentos ainda — gere as legendas para revisar por segmento.
        </p>
      )}

      {transcriptDirty && (
        <p className="text-xs text-amber-300">
          Há correções não salvas. Salve antes de exportar com legendas.
        </p>
      )}

      {pendingGlossaryOffer && (
        <div className="rounded border border-zinc-700 bg-zinc-950 p-2 text-sm">
          <p className="text-zinc-300">
            Adicionar ao glossário: “{pendingGlossaryOffer.from}” → “
            {pendingGlossaryOffer.to}”?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-emerald-800 px-2 py-1 text-xs"
              onClick={() => {
                onOfferGlossary(
                  pendingGlossaryOffer.from,
                  pendingGlossaryOffer.to
                );
                onDismissGlossaryOffer();
              }}
            >
              adicionar
            </button>
            <button
              type="button"
              className="rounded bg-zinc-800 px-2 py-1 text-xs"
              onClick={onDismissGlossaryOffer}
            >
              ignorar
            </button>
          </div>
        </div>
      )}

      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
        <button
          type="button"
          onClick={() => setGlossaryOpen((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          {glossaryOpen ? "▾" : "▸"} glossário de correção
        </button>
        {glossaryOpen && (
          <div className="mt-2 space-y-2">
            {glossaryEntries.map((entry, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  value={entry.from}
                  onChange={(e) => {
                    const next = [...glossaryEntries];
                    next[i] = { ...entry, from: e.target.value };
                    onGlossaryChange(next);
                  }}
                  className="w-28 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
                  placeholder="de"
                />
                <span className="text-zinc-500">→</span>
                <input
                  value={entry.to}
                  onChange={(e) => {
                    const next = [...glossaryEntries];
                    next[i] = { ...entry, to: e.target.value };
                    onGlossaryChange(next);
                  }}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
                  placeholder="para"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-zinc-800 px-2 py-1 text-xs"
                onClick={() =>
                  onGlossaryChange([...glossaryEntries, { from: "", to: "" }])
                }
              >
                + entrada
              </button>
              <button
                type="button"
                className="rounded bg-emerald-900 px-2 py-1 text-xs"
                onClick={onSaveGlossary}
              >
                salvar glossário
              </button>
            </div>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useSubtitles}
          onChange={(e) => onUseSubtitlesChange(e.target.checked)}
        />
        gravar legendas no vídeo
      </label>

      <div className="space-y-2">
        <p className="text-sm text-zinc-400">
          Range de legenda (relativo ao clipe, 0 = início do preview)
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={subtitleFullClip}
            onChange={onSubtitleFullClip}
          />
          trecho inteiro
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={!subtitleFullClip}
            onChange={onSubtitleSubset}
          />
          só um pedaço
        </label>
        {!subtitleFullClip && (
          <div className="flex flex-wrap gap-4">
            <label className="text-sm">
              de
              <input
                type="text"
                inputMode="text"
                value={subStartInput}
                onChange={(e) => onSubStartInputChange(e.target.value)}
                onBlur={onSubStartBlur}
                className="mt-1 block w-28 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
              />
              {subStartError && (
                <span className="ml-1 text-xs text-red-400">hora inválida</span>
              )}
            </label>
            <label className="text-sm">
              até
              <input
                type="text"
                inputMode="text"
                value={subEndInput}
                onChange={(e) => onSubEndInputChange(e.target.value)}
                onBlur={onSubEndBlur}
                className="mt-1 block w-28 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
              />
              {subEndError && (
                <span className="ml-1 text-xs text-red-400">hora inválida</span>
              )}
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

export { DEFAULT_SUBTITLE_SETTINGS };
