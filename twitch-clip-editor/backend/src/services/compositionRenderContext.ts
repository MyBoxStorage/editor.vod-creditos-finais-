import fs from "fs/promises";
import path from "path";
import type { SubtitleSettings } from "./transcribeService";
import type { CompositionSegmentSubtitleInput } from "./compositionSubtitleRemap";
import type { CompositionJoinSettings } from "./compositionJoinSettings";
import type { CompositionColorSettings } from "./compositionColorSettings";
import type { TimedWord } from "../pipeline/subtitleTiming";
import { getDataDir } from "./vodIngest";
import { getClipSegmentById } from "./clipSegmentsService";

type TranscriptJson = {
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    words?: TimedWord[];
    highlightedWordIndices?: number[];
  }>;
};

export function wordsFromTranscriptSegments(
  segments: TranscriptJson["segments"]
): TimedWord[] {
  if (!segments?.length) return [];
  const out: TimedWord[] = [];
  for (const seg of segments) {
    const highlights = new Set(seg.highlightedWordIndices ?? []);
    if (seg.words?.length) {
      seg.words.forEach((w, wi) => {
        out.push({
          word: w.word,
          start: w.start,
          end: w.end,
          ...(highlights.has(wi) || w.highlight ? { highlight: true } : {}),
        });
      });
    } else if (seg.text?.trim()) {
      out.push({
        word: seg.text.trim(),
        start: seg.start,
        end: seg.end,
      });
    }
  }
  return out;
}

export async function loadSegmentSubtitleInput(
  vodId: string,
  clipSegmentId: string,
  finalStart: number,
  finalEnd: number
): Promise<CompositionSegmentSubtitleInput> {
  const seg = getClipSegmentById(clipSegmentId);
  const dur = Math.max(0.1, finalEnd - finalStart);
  const empty = { finalStart, finalEnd, words: [] as TimedWord[] };

  const rel = seg.clipTranscriptRelativePath;
  if (!rel) return empty;

  const transcriptPath = path.join(getDataDir(), vodId, rel);
  try {
    const raw = JSON.parse(
      await fs.readFile(transcriptPath, "utf-8")
    ) as TranscriptJson;
    return {
      finalStart,
      finalEnd,
      words: wordsFromTranscriptSegments(raw.segments),
    };
  } catch {
    return { ...empty, finalEnd: finalStart + dur };
  }
}

export type CompositionRenderOptions = {
  joinSettings?: CompositionJoinSettings | null;
  colorSettings?: CompositionColorSettings | null;
  openingSettings?: import("./compositionOpeningSettings").CompositionOpeningSettings | null;
  closingSettings?: import("./compositionClosingSettings").CompositionClosingSettings | null;
  subtitleSettings?: SubtitleSettings | null;
  segmentSubtitleInputs?: CompositionSegmentSubtitleInput[];
  burnSubtitles?: boolean;
};
