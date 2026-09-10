import {
  remapCompositionSubtitleWords,
  type CompositionSegmentSubtitleInput,
} from "../services/compositionSubtitleRemap";
import type { TimedWord } from "./subtitleTiming";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const seg1Words: TimedWord[] = [
  { word: "primeiro", start: 0.2, end: 0.8 },
  { word: "trecho", start: 1.0, end: 1.5, highlight: true },
  { word: "fim", start: 4.0, end: 4.5 },
];

const seg2Words: TimedWord[] = [
  { word: "segundo", start: 0.2, end: 0.8 },
  { word: "bloco", start: 1.0, end: 1.6 },
];

// Item 9: second segment words offset by first segment duration
const twoSegs: CompositionSegmentSubtitleInput[] = [
  { finalStart: 0, finalEnd: 5, words: seg1Words },
  { finalStart: 0, finalEnd: 3, words: seg2Words },
];

const remapped = remapCompositionSubtitleWords(twoSegs);
assert(remapped.length === 5, "all in-range words kept");
assert(
  Math.abs(remapped[3].start - 5.2) < 0.01,
  "second segment starts after 5s first duration"
);
assert(remapped[1].highlight === true, "highlight preserved");
assert(remapped[3].word === "segundo", "second segment text preserved");

// Item 10: border trim on first segment — 1s off start, words shift
const trimmed: CompositionSegmentSubtitleInput[] = [
  { finalStart: 1, finalEnd: 5, words: seg1Words },
  { finalStart: 0, finalEnd: 3, words: seg2Words },
];

const remappedTrim = remapCompositionSubtitleWords(trimmed);
assert(
  !remappedTrim.some((w) => w.word === "primeiro"),
  "word before finalStart discarded"
);
assert(
  Math.abs(remappedTrim[0].start - 0) < 0.01,
  "trecho word starts at 0 after trim"
);
assert(remappedTrim[0].word === "trecho", "first kept word after border trim");
assert(
  Math.abs(remappedTrim[remappedTrim.length - 2].start - 4.2) < 0.01,
  "second segment offset uses trimmed duration (4s not 5s)"
);

console.log("compositionSubtitleRemap tests OK");
