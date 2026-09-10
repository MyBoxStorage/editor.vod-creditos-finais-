import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  saveClipTranscript,
  resyncClipSegment,
} from "../src/services/clipTranscribeService.ts";
import { resyncSegmentWords } from "../src/services/segmentResyncService.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID = "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6";
const VOD_DIR = path.join(__dirname, "..", "data", "v2820282061");
const TRANSCRIPT = path.join(VOD_DIR, "transcripts", `${ID}.json`);

async function readTranscript() {
  return JSON.parse(await fs.readFile(TRANSCRIPT, "utf-8"));
}

function avgDeviation(words: { start: number; end: number }[], ref: typeof words) {
  if (!words.length || !ref.length) return null;
  const n = Math.min(words.length, ref.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(words[i].start - ref[i].start) + Math.abs(words[i].end - ref[i].end);
  }
  return sum / (n * 2);
}

async function main() {
  const t = await readTranscript();
  const rewritten =
    "Galera, tu nunca mais fez aquela bazuca, né mano? O que só tu sabe fazer?";
  const redistributed = t.segments.map((s: { text: string }, i: number) => ({
    index: i,
    text: i === 0 ? rewritten : s.text,
  }));
  const saved = await saveClipTranscript(ID, redistributed);
  const redistWords = saved.transcript.segments[0].words;
  console.log("After rewrite (redistributed/partial):", saved.transcript.segments[0].timingStatus);
  console.log("Redist sample:", redistWords?.slice(0, 4));

  const t0 = Date.now();
  const resynced = await resyncClipSegment(ID, 0);
  const ms = Date.now() - t0;
  const seg = resynced.transcript.segments[0];
  console.log("\nResync ms:", ms);
  console.log("Text preserved:", seg.text === rewritten);
  console.log("timingStatus:", seg.timingStatus);
  console.log("Resync sample:", seg.words?.slice(0, 4));
  const dev = avgDeviation(seg.words ?? [], redistWords ?? []);
  console.log("Avg start/end deviation vs redistributed (s):", dev?.toFixed(3));

  // failure: break preview then try resync
  const preview = path.join(VOD_DIR, "previews", `${ID}.mp4`);
  const bak = preview + ".bak";
  await fs.rename(preview, bak);
  const beforeFail = await readTranscript();
  try {
    await resyncSegmentWords(ID, 0, seg.text);
    console.log("FAIL: should throw");
  } catch (e) {
    console.log("\nFailure msg:", (e as Error).message);
  }
  const afterFail = await readTranscript();
  console.log(
    "Timing preserved on failure:",
    JSON.stringify(beforeFail.segments[0].words?.[0]) ===
      JSON.stringify(afterFail.segments[0].words?.[0])
  );
  await fs.rename(bak, preview);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
