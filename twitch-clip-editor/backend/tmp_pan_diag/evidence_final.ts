/**
 * Objective evidence: Wasted pan + desat curve after fix.
 * Uses a static landmark (red vertical strip) — not gameplay.
 */
import {
  buildWastedZoomKeyframes,
  buildZoomFilterExpr,
  colorPresetFilterExpr,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "evidence");
fs.mkdirSync(tmp, { recursive: true });

const effectDur = 6;
const speed = 0.45;
const sourceSeconds = effectDur * speed;

const kfs = buildWastedZoomKeyframes(effectDur, 100);
console.log("=== KEYFRAMES ===");
for (const k of kfs) {
  console.log(`  t=${k.time} z=${k.scale} x=${k.x}`);
}
const scales = new Set(kfs.map((k) => k.scale));
console.log("unique scales (must be 1 for reliable pan):", [...scales]);

const camera = buildZoomFilterExpr(kfs, 1280, 720);
const color = colorPresetFilterExpr("wasted_grayscale", 100, {
  start: 0,
  end: effectDur,
  fadeSeconds: 0.25,
});
console.log("color expr:", color);

// Chessboard + red landmark strip at x=200
const src = path.join(tmp, "grid.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=1280x720:r=30:d=20",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=60x720:r=30:d=20",
    "-filter_complex",
    "[0][1]overlay=x=200:y=0",
    "-t",
    "20",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    src,
  ],
  { stdio: "ignore" }
);

const out = path.join(tmp, "wasted_pan.mp4");
const vf = `setpts=PTS/${speed},${camera},${color}`;
const enc = spawnSync(
  "ffmpeg",
  ["-y", "-ss", "5", "-t", String(sourceSeconds), "-i", src, "-vf", vf, "-an", out],
  { encoding: "utf8" }
);
if (enc.status !== 0) {
  console.error("ENCODE FAIL", enc.stderr.slice(-500));
  process.exit(1);
}
console.log("encoded OK →", out);

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `f_${String(t).replace(".", "_")}.png`);
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", file, "-frames:v", "1", png], {
    stdio: "ignore",
  });
  const p = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      png,
    ],
    { encoding: "utf8" }
  );
  const [w, h] = p.stdout.trim().split(",").map(Number);
  const raw = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: null, maxBuffer: 20e6 }
  );
  const buf = raw.stdout as Buffer;
  const y = Math.floor(h / 2);
  let best = -1,
    bestX = 0;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const score = buf[i] - (buf[i + 1] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      bestX = x;
    }
  }
  return bestX;
}

// Sample chroma (mean |R-G|+|G-B|) in center band — 0 ≈ B&W
function chromaScore(file: string, t: number): number {
  const png = path.join(tmp, `c_${String(t).replace(".", "_")}.png`);
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", file, "-frames:v", "1", png], {
    stdio: "ignore",
  });
  const p = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      png,
    ],
    { encoding: "utf8" }
  );
  const [w, h] = p.stdout.trim().split(",").map(Number);
  const raw = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: null, maxBuffer: 20e6 }
  );
  const buf = raw.stdout as Buffer;
  let s = 0,
    n = 0;
  for (let y = Math.floor(h * 0.4); y < h * 0.6; y++) {
    for (let x = Math.floor(w * 0.4); x < w * 0.6; x++) {
      const i = (y * w + x) * 3;
      const R = buf[i],
        G = buf[i + 1],
        B = buf[i + 2];
      s += Math.abs(R - G) + Math.abs(G - B) + Math.abs(R - B);
      n++;
    }
  }
  return s / n;
}

console.log("\n=== PAN (red strip center X) ===");
const leftT = effectDur * 0.18;
const midT = effectDur * 0.36;
const rightT = effectDur * 0.56;
const holdT = effectDur * 0.9;
const samples = [
  ["leftPeak", leftT],
  ["center", midT],
  ["rightPeak", rightT],
  ["hold", holdT],
] as const;
const xs: number[] = [];
for (const [name, t] of samples) {
  const x = findRedCenterX(out, t);
  xs.push(x);
  console.log(`  ${name} t=${t.toFixed(2)} redX=${x}`);
}
const deltaLR = xs[2] - xs[0];
console.log(`  delta left→right = ${deltaLR}px (must be clearly ≠ 0, |d|≫20)`);

console.log("\n=== DESAT (chroma score, lower=more B&W) ===");
for (const t of [0.2, effectDur * 0.45, effectDur * 0.7, effectDur * 0.98]) {
  console.log(`  t=${t.toFixed(2)} chroma=${chromaScore(out, t).toFixed(1)}`);
}

if (Math.abs(deltaLR) < 40) {
  console.error("\nFAIL: pan not perceptible in pixels");
  process.exit(1);
}
console.log("\nPASS: pan displacement clearly measurable");
