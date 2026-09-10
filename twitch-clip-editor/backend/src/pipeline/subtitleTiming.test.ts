import {
  DEFAULT_SUBTITLE_CLEAR_GAP_SEC,
  DEFAULT_SUBTITLE_TAIL_SEC,
  findActiveAnimatedSubtitle,
  findActiveClassicSegment,
  findActiveWordInSegment,
  nextSpeechStart,
  segmentClassicVisibleEnd,
  wordVisibleEnd,
  windowWordRange,
  type TimedSegment,
} from "./subtitleTiming";

const CLIP_8CD9_SEGMENTS: TimedSegment[] = [
  {
    start: 2.56,
    end: 4.32,
    text: "É assim que a gente morre ruxando assim",
    words: [
      { word: "É", start: 2.56, end: 2.7 },
      { word: "assim", start: 2.7, end: 2.82 },
      { word: "que", start: 2.82, end: 2.94 },
      { word: "a", start: 2.94, end: 3 },
      { word: "gente", start: 3, end: 3.18 },
      { word: "morre", start: 3.18, end: 3.62 },
      { word: "ruxando", start: 3.62, end: 4 },
      { word: "assim", start: 4, end: 4.32 },
    ],
  },
  {
    start: 7.98,
    end: 11.32,
    text: "Essa frase eu também vou anotar pro Tropa de Elite 3",
    words: [
      { word: "Essa", start: 7.98, end: 8.42 },
      { word: "frase", start: 8.42, end: 8.84 },
    ],
  },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const config = {
  tailAfterSpeechSec: DEFAULT_SUBTITLE_TAIL_SEC,
  clearGapThresholdSec: DEFAULT_SUBTITLE_CLEAR_GAP_SEC,
};

// Gap 4.32–7.98: screen must be clear
assert(
  findActiveAnimatedSubtitle(CLIP_8CD9_SEGMENTS, 5, config) === null,
  "gap between segments is clear at t=5"
);
assert(
  findActiveAnimatedSubtitle(CLIP_8CD9_SEGMENTS, 4.7, config) === null,
  "after tail (4.62) screen is clear at t=4.7"
);
assert(
  findActiveAnimatedSubtitle(CLIP_8CD9_SEGMENTS, 4.5, config)?.wordIndex === 7,
  "last word still visible inside tail at t=4.5"
);

// Window never crosses segments
const lastWordHit = findActiveAnimatedSubtitle(CLIP_8CD9_SEGMENTS, 4.1, config);
assert(lastWordHit?.segmentIndex === 0 && lastWordHit.wordIndex === 7, "active at last word seg0");
const range = windowWordRange(
  CLIP_8CD9_SEGMENTS[0].words!.length,
  lastWordHit!.wordIndex,
  "one_at_a_time"
);
assert(range.end <= CLIP_8CD9_SEGMENTS[0].words!.length, "window stays inside segment");

// Short intra-segment gap holds (mano gap 0.54–0.68 = 0.14s < 0.8)
const shortGapSeg: TimedSegment[] = [
  {
    start: 0,
    end: 0.94,
    text: "Vão subir não mano",
    words: [
      { word: "não", start: 0.34, end: 0.54 },
      { word: "mano", start: 0.68, end: 0.94 },
    ],
  },
];
assert(
  findActiveWordInSegment(shortGapSeg[0].words!, 0.6, config) === 0,
  "short gap holds previous word"
);

// Classic segment end respects gap
const classicEnd = segmentClassicVisibleEnd(
  CLIP_8CD9_SEGMENTS[0],
  nextSpeechStart(CLIP_8CD9_SEGMENTS, 0),
  config
);
assert(Math.abs(classicEnd - 4.62) < 0.01, "classic ends at speech end + tail across large gap");

assert(
  findActiveClassicSegment(CLIP_8CD9_SEGMENTS, 5, config) === null,
  "classic clear in gap"
);

// Long segment window slides inside segment only
const longWords = Array.from({ length: 10 }, (_, i) => ({
  word: `w${i}`,
  start: i,
  end: i + 0.5,
}));
const longRange = windowWordRange(longWords.length, 8, "active_word");
assert(longRange.end - longRange.start <= 6, "active_word caps window at 6");

console.log("subtitleTiming tests OK");
