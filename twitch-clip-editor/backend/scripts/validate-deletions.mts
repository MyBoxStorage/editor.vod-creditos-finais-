import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { reconcileSegmentWordTimings } from "../src/services/wordTimingDiff.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fresh = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "data", "_val_frames", "fresh_transcript.json"),
    "utf-8"
  )
);
const seg = fresh.segments[0];
const oldWords = seg.words;
const start = seg.start;
const end = seg.end;

function show(label: string, text: string) {
  console.log(`\n=== ${label} ===`);
  console.log("BEFORE (relevant):");
  oldWords.forEach((w, i) =>
    console.log(
      `  [${i}] ${w.word.trim().padEnd(14)} ${w.start.toFixed(3)}–${w.end.toFixed(3)}`
    )
  );
  const r = reconcileSegmentWordTimings(oldWords, text, start, end);
  console.log("AFTER:");
  console.log("status:", r.timingStatus);
  r.words.forEach((w, i) =>
    console.log(
      `  [${i}] ${w.word.padEnd(14)} ${w.start.toFixed(3)}–${w.end.toFixed(3)}`
    )
  );
  return r;
}

console.log("OLD first:", oldWords[0]);
console.log("OLD last:", oldWords[oldWords.length - 1]);

// a) remove first word
const t1 = seg.text.replace(/^Gente,\s*/, "");
show("a) REMOVE FIRST (Gente,)", t1);

// b) remove last word
const t2 = seg.text.replace(/\s*fazer\?\s*$/, "");
show("b) REMOVE LAST (fazer?)", t2);

// c) remove two consecutive from middle - remove "nunca mais"
const t3 = seg.text.replace(/\bnunca mais\b/, "").replace(/\s+/g, " ").trim();
show("c) REMOVE TWO MIDDLE (nunca mais)", t3);

// d) replace one word
const t4 = seg.text.replace("Gente,", "Pedrinho,");
show("d) REPLACE Gente→Pedrinho", t4);
