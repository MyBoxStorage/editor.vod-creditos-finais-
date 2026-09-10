import type { TimedWord } from "../pipeline/subtitleTiming";

/** One trecho on the final clip timeline (after border trim). */
export type CompositionSegmentSubtitleInput = {
  /** Clip-relative interval start after border trim (seconds). */
  finalStart: number;
  /** Clip-relative interval end after border trim (seconds). */
  finalEnd: number;
  /** Word timings clip-relative to the trecho's full marked interval. */
  words: TimedWord[];
};

/**
 * Remap per-trecho word timings onto the composed clip timeline.
 * Words outside [finalStart, finalEnd] are discarded — same rule as
 * collectSegmentWords in captionGenerator (camada 2).
 */
export function remapCompositionSubtitleWords(
  segments: CompositionSegmentSubtitleInput[]
): TimedWord[] {
  const out: TimedWord[] = [];
  let timelineOffset = 0;

  for (const seg of segments) {
    const clipStart = seg.finalStart;
    const clipEnd = seg.finalEnd;
    const segDuration = Math.max(0, clipEnd - clipStart);

    for (const w of seg.words) {
      if (w.end < clipStart || w.start > clipEnd) continue;
      const relStart = Math.max(0, w.start - clipStart);
      const relEnd = Math.max(relStart + 0.01, w.end - clipStart);
      out.push({
        word: w.word,
        start: Number((timelineOffset + relStart).toFixed(3)),
        end: Number((timelineOffset + relEnd).toFixed(3)),
        ...(w.highlight ? { highlight: true } : {}),
      });
    }

    timelineOffset += segDuration;
  }

  return out;
}

/** Flat word list → segments for captionGenerator-style consumption. */
export function remappedWordsToTimedSegments(words: TimedWord[]) {
  if (words.length === 0) return [];
  return [
    {
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((w) => w.word).join(" "),
      words,
    },
  ];
}
