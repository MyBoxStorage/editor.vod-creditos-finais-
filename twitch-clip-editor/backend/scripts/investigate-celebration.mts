import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportCandidate } from "../src/services/candidateExportService.ts";
import { findClipEditableById } from "../src/services/clipEditable.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_celebration");

function probe(p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        p,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
    );
  });
}

async function extractFrame(video: string, t: number, outPng: string) {
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-ss", String(t), "-i", video, "-frames:v", "1", outPng],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`frame @${t}`))
    );
  });
}

/** Mean luma of bottom 50% of frame (0=black, 255=bright). */
async function bottomHalfLuma(png: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn(
      "ffmpeg",
      [
        "-i",
        png,
        "-vf",
        "crop=iw:ih/2:0:ih/2,scale=1:1,signalstats",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error("signalstats"));
      const m = out.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
      resolve(m ? parseFloat(m[1]) : NaN);
    });
  });
}

async function exportCelebration(
  candidateId: string,
  effectStart: number,
  preset: "vertical-split-9x16" | "horizontal-16x9"
) {
  const c = await findClipEditableById(candidateId);
  const clipDuration = Math.max(0.1, c.end - c.start);
  const expanded = expandEmotionPreset({
    presetId: "celebration",
    effectStart,
    effectEnd: effectStart + 0.9,
    clipDuration,
    intensityPercent: 100,
  });
  const r = await exportCandidate(candidateId, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset,
    zoomKeyframes: expanded.zoomKeyframes,
    colorPreset: expanded.colorPreset ?? "none",
    colorEffectStart: effectStart,
    colorEffectEnd: effectStart + 0.9,
  });
  return { path: r.prontosPath, effectStart, preset };
}

async function analyzeExport(
  tag: string,
  candidateId: string,
  effectStart: number,
  preset: "vertical-split-9x16" | "horizontal-16x9"
) {
  const { path: video } = await exportCelebration(
    candidateId,
    effectStart,
    preset
  );
  const mid = effectStart + 0.45;
  const before = effectStart - 0.5;
  const after = effectStart + 1.0;
  const frames: { t: number; luma: number }[] = [];
  for (const t of [before, mid, after]) {
    const png = path.join(OUT, `${tag}_${preset}_${t.toFixed(1)}s.png`);
    await extractFrame(video, t, png);
    const luma = await bottomHalfLuma(png);
    frames.push({ t, luma });
  }
  return { tag, candidateId, preset, effectStart, frames, blackMid: frames[1].luma < 20 };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const CID = "62920681-08e8-4591-90b9-5a80f55ebc5b";
  const positions = [3, 8, 15];
  const results = [];
  for (const pos of positions) {
    results.push(
      await analyzeExport(`pos${pos}`, CID, pos, "vertical-split-9x16")
    );
  }
  results.push(
    await analyzeExport("pos12_h", CID, 12, "horizontal-16x9")
  );

  // Other candidate if exists
  const otherId = "a1c8e0e2-示例";
  try {
    await findClipEditableById(otherId);
  } catch {
    // list candidates from vod
  }
  const vodDir = path.join(__dirname, "..", "data", "v2820282061");
  const editables = await fs.readdir(path.join(vodDir, "marked")).catch(() => []);
  let other: string | null = null;
  for (const f of editables) {
    if (f.endsWith(".json") && !f.includes(CID)) {
      other = f.replace(".json", "");
      break;
    }
  }
  if (other) {
    results.push(
      await analyzeExport(`other_${other.slice(0, 8)}`, other, 5, "vertical-split-9x16")
    );
  }

  console.log(JSON.stringify({ results, otherCandidate: other }, null, 2));
  await fs.writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify(results, null, 2)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
