"use client";

import type { TimedWord } from "../../../../../../lib/compositionSubtitleRemap";
import {
  buildRemappedSubtitleSegments,
  remapCompositionSubtitleWords,
  type CompositionSegmentSubtitleInput,
} from "../../../../../../lib/compositionSubtitleRemap";

export const MIN_BLOCK_PX = 24;

type SubtitleTrackProps = {
  totalDuration: number;
  trackWidthPx: number;
  segmentInputs: CompositionSegmentSubtitleInput[];
  joinTimes: number[];
};

function blockPx(
  startSec: number,
  endSec: number,
  duration: number,
  trackWidthPx: number
): { left: number; width: number } {
  if (!(trackWidthPx > 0 && duration > 0)) {
    return { left: 0, width: MIN_BLOCK_PX };
  }
  const left = (startSec / duration) * trackWidthPx;
  const realWidth = ((endSec - startSec) / duration) * trackWidthPx;
  return { left, width: Math.max(MIN_BLOCK_PX, realWidth) };
}

export function SubtitleTrack({
  totalDuration,
  trackWidthPx,
  segmentInputs,
  joinTimes,
}: SubtitleTrackProps) {
  const remappedWords = remapCompositionSubtitleWords(segmentInputs);
  const segments = buildRemappedSubtitleSegments(remappedWords, joinTimes);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-right text-[11px] text-zinc-500">
          legenda
        </span>
        <div
          className="relative h-7 flex-1 rounded border border-zinc-800 bg-zinc-900/80"
          style={{ minHeight: 28 }}
        >
          {segments.map((seg, i) => {
            const { left, width } = blockPx(
              seg.start,
              seg.end,
              totalDuration,
              trackWidthPx
            );
            return (
              <div
                key={`${i}-${seg.start}`}
                className={`pointer-events-none absolute top-1 bottom-1 rounded px-0.5 text-[9px] leading-none ${
                  seg.crossesJoin
                    ? "border border-amber-500/60 bg-amber-900/40 text-amber-100"
                    : "bg-violet-700/50 text-violet-100"
                }`}
                style={{ left, width }}
                title={
                  seg.crossesJoin
                    ? `${seg.text} (cruza emenda)`
                    : seg.text
                }
              >
                <span className="block truncate pt-1">{seg.text}</span>
              </div>
            );
          })}
          {segments.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-600">
              sem legendas
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function wordsFromTranscriptSegments(
  segments: Array<{
    words?: Array<{ word: string; start: number; end: number }>;
  }>
): TimedWord[] {
  const out: TimedWord[] = [];
  for (const seg of segments) {
    for (const w of seg.words ?? []) {
      out.push({ word: w.word, start: w.start, end: w.end });
    }
  }
  return out;
}
