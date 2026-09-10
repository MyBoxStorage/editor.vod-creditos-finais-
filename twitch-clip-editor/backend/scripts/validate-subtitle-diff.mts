import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  reconcileSegmentWordTimings,
  normalizeSpokenWord,
} from "../src/services/wordTimingDiff.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fresh = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "data", "_val_frames", "fresh_transcript.json"),
    "utf-8"
  )
);

const seg0 = fresh.segments[0];
const oldWords = seg0.words;

console.log("=== DIFF CASES ===\n");

// 1 equal - no change
const c1 = reconcileSegmentWordTimings(oldWords, seg0.text, seg0.start, seg0.end);
console.log("1 EQUAL:", c1.timingStatus, c1.words[2]);

// 2 substitute one word
const newText2 = seg0.text.replace("Gente", "Pedrinho");
const c2 = reconcileSegmentWordTimings(oldWords, newText2, seg0.start, seg0.end);
console.log("2 SUBSTITUTE:", c2.timingStatus, {
  before: { word: oldWords[0].word, start: oldWords[0].start, end: oldWords[0].end },
  after: { word: c2.words[0].word, start: c2.words[0].start, end: c2.words[0].end },
});

// 3 accent only
const newText3 = seg0.text.replace("Gente", "Gente"); // same
const c3 = reconcileSegmentWordTimings(oldWords, "Gente, tu nunca mais fez aquela bazuca, né mano? O que só tu sabe fazer?", seg0.start, seg0.end);
const newText3b = "Gente, tu nunca mais fez aquela bazuca, ne mano? O que só tu sabe fazer?";
const c3b = reconcileSegmentWordTimings(oldWords, newText3b, seg0.start, seg0.end);
console.log("3 ACCENT (ne/né):", c3b.timingStatus, {
  before_ne: oldWords.find((w: { word: string }) => normalizeSpokenWord(w.word) === "ne"),
  after_ne: c3b.words.find((w) => normalizeSpokenWord(w.word) === "ne"),
});

// 4 insert two words
const newText4 = "Gente, tu nunca mais fez aquela bazuca incrível demais, né mano? O que só tu sabe fazer?";
const c4 = reconcileSegmentWordTimings(oldWords, newText4, seg0.start, seg0.end);
const bazucaBefore = oldWords.find((w: { word: string }) => w.word.includes("bazuca"));
const incrIdx = c4.words.findIndex((w) => w.word === "incrível");
console.log("4 INSERT:", c4.timingStatus, {
  bazucaBefore: { start: bazucaBefore?.start, end: bazucaBefore?.end },
  bazucaAfter: c4.words.find((w) => w.word.includes("bazuca")),
  inserted: [c4.words[incrIdx], c4.words[incrIdx + 1]],
});

// 5 remove word
const newText5 = "Gente, tu nunca mais fez aquela bazuca, mano? O que só tu sabe fazer?";
const c5 = reconcileSegmentWordTimings(oldWords, newText5, seg0.start, seg0.end);
const neBefore = oldWords.find((w: { word: string }) => normalizeSpokenWord(w.word) === "ne");
console.log("5 REMOVE:", c5.timingStatus, {
  removed_ne: neBefore,
  prev_after: c5.words.find((w) => normalizeSpokenWord(w.word) === "bazuca,"),
});

// 6 full rewrite
const c6 = reconcileSegmentWordTimings(oldWords, "Texto completamente diferente aqui", seg0.start, seg0.end);
console.log("6 REWRITE:", c6.timingStatus, c6.words.slice(0, 2));

writeFileSync(
  path.join(__dirname, "..", "data", "_val_frames", "diff_report.json"),
  JSON.stringify({ c1, c2, c3b, c4, c5, c6 }, null, 2)
);
