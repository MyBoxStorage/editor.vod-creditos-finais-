import type { ClipTranscript, SubtitleRenderSnapshot } from "./api";
import {
  findActiveAnimatedSubtitle,
  findActiveClassicSegment,
  gapConfigFromSettings,
  windowWordRange,
  type TimedSegment,
} from "./subtitleTiming";

export type SubtitleStyleId =
  | "active_word"
  | "one_at_a_time"
  | "block_highlight"
  | "classic";

export type SegmentTimingStatus = "original" | "partial" | "redistributed";

export type SubtitleSettings = {
  style: SubtitleStyleId;
  uppercase: boolean;
  highlightColor: string;
  fontSize: number;
  positionPercent: number;
  outlineWidth: number;
  tailAfterSpeechSec: number;
  clearGapThresholdSec: number;
};

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  style: "active_word",
  uppercase: false,
  highlightColor: "#FFD93D",
  fontSize: 72,
  positionPercent: 68,
  outlineWidth: 8,
  tailAfterSpeechSec: 0.3,
  clearGapThresholdSec: 0.8,
};

export const SUBTITLE_STYLE_OPTIONS: Array<{
  id: SubtitleStyleId;
  label: string;
}> = [
  { id: "active_word", label: "palavra ativa" },
  { id: "one_at_a_time", label: "uma por vez" },
  { id: "block_highlight", label: "bloco com destaque" },
  { id: "classic", label: "clássico" },
];

export const TIMING_STATUS_LABELS: Record<SegmentTimingStatus, string> = {
  original: "timing original da transcrição",
  partial: "timing parcialmente preservado",
  redistributed: "timing redistribuído",
};

export function tokenizeSegmentText(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalizeSpokenWord(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

/** Word substitutions between two segment texts (for glossary offers). */
export function findWordSubstitutions(
  oldText: string,
  newText: string
): Array<{ from: string; to: string }> {
  const oldTokens = tokenizeSegmentText(oldText);
  const newTokens = tokenizeSegmentText(newText);
  const a = oldTokens.map(normalizeSpokenWord);
  const b = newTokens.map(normalizeSpokenWord);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const raw: Array<{ oldIdx: number | null; newIdx: number | null }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ oldIdx: i, newIdx: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ oldIdx: i, newIdx: null });
      i++;
    } else {
      raw.push({ oldIdx: null, newIdx: j });
      j++;
    }
  }
  while (i < n) raw.push({ oldIdx: i++, newIdx: null });
  while (j < m) raw.push({ oldIdx: null, newIdx: j++ });

  const out: Array<{ from: string; to: string }> = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const next = raw[k + 1];
    if (
      cur.oldIdx != null &&
      cur.newIdx == null &&
      next?.oldIdx == null &&
      next.newIdx != null
    ) {
      const from = oldTokens[cur.oldIdx];
      const to = newTokens[next.newIdx];
      if (from && to && normalizeSpokenWord(from) !== normalizeSpokenWord(to)) {
        out.push({ from, to });
      }
      k++;
    }
  }
  return out;
}

export type SubtitleWordFrame = {
  text: string;
  active: boolean;
  customHighlight: boolean;
};

export type SubtitlePreviewFrame = {
  words: SubtitleWordFrame[];
  style: SubtitleStyleId;
  uppercase: boolean;
  highlightColor: string;
  fontSize: number;
  positionPercent: number;
  outlineWidth: number;
};

function toTimedSegments(transcript: ClipTranscript): TimedSegment[] {
  return transcript.segments.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
    words: seg.words,
  }));
}

export function getSubtitlePreviewFrame(
  transcript: ClipTranscript | null,
  t: number,
  settings: SubtitleSettings = DEFAULT_SUBTITLE_SETTINGS
): SubtitlePreviewFrame | null {
  if (!transcript?.segments?.length) return null;
  const merged = { ...DEFAULT_SUBTITLE_SETTINGS, ...transcript.subtitle, ...settings };
  const gapConfig = gapConfigFromSettings(merged);
  const segments = toTimedSegments(transcript);

  if (merged.style === "classic") {
    const segIndex = findActiveClassicSegment(segments, t, gapConfig);
    if (segIndex == null) return null;
    const seg = transcript.segments[segIndex];
    const text = merged.uppercase ? seg.text.toUpperCase() : seg.text;
    return {
      words: [{ text, active: true, customHighlight: false }],
      ...merged,
    };
  }

  const hit = findActiveAnimatedSubtitle(segments, t, gapConfig);
  if (!hit) return null;
  const seg = transcript.segments[hit.segmentIndex];
  const highlights = new Set(seg.highlightedWordIndices ?? []);
  const words = seg.words ?? [];
  const tokens = tokenizeSegmentText(seg.text);
  if (words.length === 0) {
    const text = merged.uppercase ? seg.text.toUpperCase() : seg.text;
    return {
      words: [{ text, active: true, customHighlight: false }],
      ...merged,
    };
  }

  const activeIdx = hit.wordIndex;
  const range = windowWordRange(tokens.length, activeIdx, merged.style);
  const frameWords: SubtitleWordFrame[] = [];
  for (let i = range.start; i < range.end; i++) {
    const raw = tokens[i] ?? words[i]?.word ?? "";
    frameWords.push({
      text: merged.uppercase ? raw.toUpperCase() : raw,
      active: i === activeIdx,
      customHighlight: highlights.has(i),
    });
  }

  return { words: frameWords, ...merged };
}

/** Live subtitle payload for faithful preview cache + burn. */
export function buildSubtitleRenderSnapshot(
  transcript: ClipTranscript | null,
  segmentTexts: string[],
  segmentHighlights: number[][],
  subtitleSettings: SubtitleSettings
): SubtitleRenderSnapshot | null {
  if (!transcript) return null;
  return {
    settings: subtitleSettings,
    segments: transcript.segments.map((seg, i) => ({
      text: segmentTexts[i] ?? seg.text,
      start: seg.start,
      end: seg.end,
      words: seg.words,
      highlightedWordIndices: segmentHighlights[i] ?? [],
      timingStatus: seg.timingStatus,
    })),
  };
}
