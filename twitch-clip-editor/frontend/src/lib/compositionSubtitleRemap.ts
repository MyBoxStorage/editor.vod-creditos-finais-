/** Mirrors backend compositionSubtitleRemap — remaps trecho words to final clip timeline. */

export type TimedWord = {
  word: string;
  start: number;
  end: number;
  highlight?: boolean;
};

export type CompositionSegmentSubtitleInput = {
  finalStart: number;
  finalEnd: number;
  words: TimedWord[];
};

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

export type RemappedSubtitleSegment = {
  start: number;
  end: number;
  text: string;
  words: TimedWord[];
  crossesJoin: boolean;
};

/** Group remapped words into display segments; flag those spanning a join boundary. */
export function buildRemappedSubtitleSegments(
  words: TimedWord[],
  joinTimes: number[]
): RemappedSubtitleSegment[] {
  if (words.length === 0) return [];
  const joins = new Set(joinTimes.map((t) => Number(t.toFixed(3))));
  const segments: RemappedSubtitleSegment[] = [];
  let cur: TimedWord[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const start = cur[0].start;
    const end = cur[cur.length - 1].end;
    let crossesJoin = false;
    for (const j of joins) {
      if (start + 0.001 < j && end - 0.001 > j) {
        crossesJoin = true;
        break;
      }
    }
    segments.push({
      start,
      end,
      text: cur.map((w) => w.word).join(" "),
      words: [...cur],
      crossesJoin,
    });
    cur = [];
  };

  for (const w of words) {
    cur.push(w);
  }
  flush();
  return segments;
}
