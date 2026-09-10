import type { SubtitleStyleId } from "../services/transcribeService";

/** Default tail after last spoken word before clearing (seconds). */
export const DEFAULT_SUBTITLE_TAIL_SEC = 0.3;
/** Gaps longer than this leave the screen clear between speech. */
export const DEFAULT_SUBTITLE_CLEAR_GAP_SEC = 0.8;

export const CAPTION_MAX_WORDS_ACTIVE = 6;
export const CAPTION_MAX_WORDS_ONE = 2;
export const MIN_WORD_GAP_MS = 50;

export type SubtitleGapConfig = {
  tailAfterSpeechSec: number;
  clearGapThresholdSec: number;
};

export const DEFAULT_SUBTITLE_GAP_CONFIG: SubtitleGapConfig = {
  tailAfterSpeechSec: DEFAULT_SUBTITLE_TAIL_SEC,
  clearGapThresholdSec: DEFAULT_SUBTITLE_CLEAR_GAP_SEC,
};

export type TimedWord = {
  word: string;
  start: number;
  end: number;
  highlight?: boolean;
};

export type TimedSegment = {
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
};

export function nextSpeechStart(
  segments: TimedSegment[],
  segmentIndex: number
): number | null {
  const next = segments[segmentIndex + 1];
  if (!next) return null;
  const words = next.words ?? [];
  if (words.length > 0) return words[0].start;
  return next.start;
}

export function segmentSpeechEnd(seg: TimedSegment): number {
  const words = seg.words ?? [];
  if (words.length > 0) return words[words.length - 1].end;
  return seg.end;
}

export function segmentSpeechStart(seg: TimedSegment): number {
  const words = seg.words ?? [];
  if (words.length > 0) return words[0].start;
  return seg.start;
}

/** When a word's on-screen event ends (never stretches into the next segment). */
export function wordVisibleEnd(
  words: TimedWord[],
  wordIndex: number,
  config: SubtitleGapConfig
): number {
  const w = words[wordIndex];
  const next = words[wordIndex + 1];
  if (!next) return w.end + config.tailAfterSpeechSec;
  const gap = next.start - w.end;
  if (gap > config.clearGapThresholdSec) {
    return w.end + config.tailAfterSpeechSec;
  }
  return next.start;
}

export function segmentClassicVisibleEnd(
  seg: TimedSegment,
  nextSpeechStartSec: number | null,
  config: SubtitleGapConfig
): number {
  const speechEnd = segmentSpeechEnd(seg);
  if (nextSpeechStartSec == null) return speechEnd + config.tailAfterSpeechSec;
  const gap = nextSpeechStartSec - speechEnd;
  if (gap > config.clearGapThresholdSec) {
    return speechEnd + config.tailAfterSpeechSec;
  }
  return nextSpeechStartSec;
}

export function findActiveWordInSegment(
  words: TimedWord[],
  t: number,
  config: SubtitleGapConfig
): number | null {
  for (let i = 0; i < words.length; i++) {
    const end = wordVisibleEnd(words, i, config);
    if (t >= words[i].start && t < end) return i;
  }
  return null;
}

export function findActiveAnimatedSubtitle(
  segments: TimedSegment[],
  t: number,
  config: SubtitleGapConfig
): { segmentIndex: number; wordIndex: number } | null {
  for (let si = 0; si < segments.length; si++) {
    const words = segments[si].words ?? [];
    if (words.length === 0) continue;
    const wi = findActiveWordInSegment(words, t, config);
    if (wi != null) return { segmentIndex: si, wordIndex: wi };
  }
  return null;
}

export function findActiveClassicSegment(
  segments: TimedSegment[],
  t: number,
  config: SubtitleGapConfig
): number | null {
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const start = segmentSpeechStart(seg);
    const end = segmentClassicVisibleEnd(
      seg,
      nextSpeechStart(segments, si),
      config
    );
    if (t >= start && t < end) return si;
  }
  return null;
}

export function maxVisibleForStyle(style: SubtitleStyleId): number {
  return style === "one_at_a_time" ? CAPTION_MAX_WORDS_ONE : CAPTION_MAX_WORDS_ACTIVE;
}

/** Word window indices [start, end) always inside one segment. */
export function windowWordRange(
  wordCount: number,
  activeIndex: number,
  style: SubtitleStyleId
): { start: number; end: number } {
  const maxVisible = maxVisibleForStyle(style);
  if (wordCount <= 0) return { start: 0, end: 0 };
  if (style === "one_at_a_time") {
    const start = Math.max(0, Math.min(activeIndex, wordCount - 1));
    return { start, end: Math.min(wordCount, start + maxVisible) };
  }
  let windowStart = Math.max(0, activeIndex - Math.floor(maxVisible / 2));
  let windowEnd = Math.min(wordCount, windowStart + maxVisible);
  windowStart = Math.max(0, windowEnd - maxVisible);
  return { start: windowStart, end: windowEnd };
}

export function enforceWordGap(words: TimedWord[]): TimedWord[] {
  if (words.length < 2) return words.map((w) => ({ ...w }));
  const out = words.map((w) => ({ ...w }));
  for (let i = 1; i < out.length; i++) {
    const gapMs = (out[i].start - out[i - 1].end) * 1000;
    if (gapMs < MIN_WORD_GAP_MS) {
      out[i].start = out[i - 1].end + MIN_WORD_GAP_MS / 1000;
    }
    if (out[i].end <= out[i].start) {
      out[i].end = out[i].start + 0.08;
    }
  }
  return out;
}

export function gapConfigFromSettings(settings?: {
  tailAfterSpeechSec?: number;
  clearGapThresholdSec?: number;
}): SubtitleGapConfig {
  return {
    tailAfterSpeechSec:
      typeof settings?.tailAfterSpeechSec === "number"
        ? settings.tailAfterSpeechSec
        : DEFAULT_SUBTITLE_TAIL_SEC,
    clearGapThresholdSec:
      typeof settings?.clearGapThresholdSec === "number"
        ? settings.clearGapThresholdSec
        : DEFAULT_SUBTITLE_CLEAR_GAP_SEC,
  };
}
