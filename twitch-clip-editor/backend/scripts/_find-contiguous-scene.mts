import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb, getDb } from "../src/db/index.js";

initDb();
const VOD = "v2820282061";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vodDir = path.join(__dirname, "..", "data", VOD);

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
    );
  });
}

type Word = { word: string; start: number; end: number };

async function loadWordsFromTranscript(rel: string): Promise<Word[]> {
  try {
    const raw = await fs.readFile(path.join(vodDir, rel), "utf8");
    const data = JSON.parse(raw) as {
      segments?: Array<{ words?: Word[]; start?: number; end?: number; text?: string }>;
    };
    const words: Word[] = [];
    for (const seg of data.segments ?? []) {
      if (seg.words?.length) words.push(...seg.words);
      else if (seg.text && seg.start != null && seg.end != null) {
        words.push({ word: seg.text, start: seg.start, end: seg.end });
      }
    }
    return words;
  } catch {
    return [];
  }
}

async function main() {
  const source = path.join(vodDir, "source.mp4");
  const dur = await probeDuration(source);
  console.log("VOD duration", dur);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, source_start, source_end, clip_transcript_relative_path, status
       FROM clip_segments WHERE vod_id = ? ORDER BY source_start`
    )
    .all(VOD) as Array<{
    id: string;
    source_start: number;
    source_end: number;
    clip_transcript_relative_path: string | null;
    status: string | null;
  }>;

  console.log("existing segments", rows.length);
  for (const r of rows.slice(0, 15)) {
    console.log(
      r.id.slice(0, 8),
      r.source_start.toFixed(1),
      r.source_end.toFixed(1),
      (r.source_end - r.source_start).toFixed(1),
      r.status,
      r.clip_transcript_relative_path?.slice(0, 30) ?? "-"
    );
  }

  // Find segment with transcript and scan for dense speech window
  for (const r of rows) {
    if (!r.clip_transcript_relative_path) continue;
    const words = await loadWordsFromTranscript(r.clip_transcript_relative_path);
    if (words.length < 20) continue;
    const absWords = words.map((w) => ({
      ...w,
      absStart: r.source_start + w.start,
      absEnd: r.source_start + w.end,
    }));
    // sliding 120s window with most words
    let best = { start: 0, count: 0 };
    for (let t = r.source_start; t < r.source_end - 60; t += 10) {
      const count = absWords.filter(
        (w) => w.absStart >= t && w.absStart < t + 120
      ).length;
      if (count > best.count) best = { start: t, count };
    }
    if (best.count > 30) {
      console.log("\nCandidate window in seg", r.id.slice(0, 8), best);
      const winStart = best.start;
      const winEnd = best.start + 120;
      const inWin = absWords.filter(
        (w) => w.absStart >= winStart && w.absStart < winEnd
      );
      console.log("words in window", inWin.length);
      console.log("sample", inWin.slice(0, 8).map((w) => `${w.absStart.toFixed(1)}:${w.word}`).join(" "));
      break;
    }
  }

  // Also check full VOD transcript if exists
  const candidates = db
    .prepare(`SELECT id, source_start, source_end FROM candidates WHERE vod_id = ? LIMIT 5`)
    .all(VOD);
  console.log("\ncandidates", candidates);
}

main().catch(console.error);
