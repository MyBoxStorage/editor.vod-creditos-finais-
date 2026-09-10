/**
 * Pan-only evidence (no desat) so the red landmark stays detectable at both peaks.
 * Separate desat check on a colorful source without relying on red detection.
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
const kfs = buildWastedZoomKeyframes(effectDur, 100);
const camera = buildZoomFilterExpr(kfs, 1280, 720);

const src = path.join(tmp, "grid.mp4");
if (!fs.existsSync(src)) {
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
}

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `p_${String(t).replace(".", "_")}.png`);
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

function chromaScore(file: string, t: number): number {
  const png = path.join(tmp, `ch_${String(t).replace(".", "_")}.png`);
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

// --- PAN only ---
const panOut = path.join(tmp, "pan_only.mp4");
let r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "5",
    "-t",
    String(effectDur * speed),
    "-i",
    src,
    "-vf",
    `setpts=PTS/${speed},${camera}`,
    "-an",
    panOut,
  ],
  { encoding: "utf8" }
);
if (r.status !== 0) {
  console.error(r.stderr.slice(-400));
  process.exit(1);
}

const leftT = effectDur * 0.18;
const rightT = effectDur * 0.56;
const midT = effectDur * 0.36;
const L = findRedCenterX(panOut, leftT);
const M = findRedCenterX(panOut, midT);
const R = findRedCenterX(panOut, rightT);
const d = R - L;
console.log("PAN (no desat, red landmark on testsrc grid)");
console.log(`  leftPeak  t=${leftT} redX=${L}`);
console.log(`  center    t=${midT} redX=${M}`);
console.log(`  rightPeak t=${rightT} redX=${R}`);
console.log(`  delta L→R = ${d}px`);

// --- DESAT only (no camera) on smptebars ---
const bars = path.join(tmp, "bars.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "smptebars=s=1280x720:r=30:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    bars,
  ],
  { stdio: "ignore" }
);
const color = colorPresetFilterExpr("wasted_grayscale", 100, {
  start: 0,
  end: effectDur,
  fadeSeconds: 0.25,
})!;
const desatOut = path.join(tmp, "desat_only.mp4");
r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    bars,
    "-vf",
    `setpts=PTS/${speed},${color}`,
    "-t",
    String(effectDur),
    "-an",
    desatOut,
  ],
  { encoding: "utf8" }
);
if (r.status !== 0) {
  console.error(r.stderr.slice(-400));
  process.exit(1);
}
console.log("\nDESAT (smptebars chroma; peak B&W at 45%=2.7s)");
for (const t of [0.15, 1.5, 2.7, 4.0, 5.9]) {
  console.log(`  t=${t} chroma=${chromaScore(desatOut, t).toFixed(1)}`);
}

if (Math.abs(d) < 80) {
  console.error("\nFAIL pan");
  process.exit(1);
}
console.log("\nPASS");
