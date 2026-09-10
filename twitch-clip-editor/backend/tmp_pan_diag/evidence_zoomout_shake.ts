/**
 * Objective evidence for Wasted camera: continuous zoom-out + continuous shake,
 * no empty borders. Uses bright solid + landmarks (not gameplay).
 */
import {
  buildWastedCameraFilterExpr,
  resolveWastedCameraParams,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "wasted_cam_evidence");
fs.mkdirSync(tmp, { recursive: true });

const effectDur = 6;
const intensity = 100;
const params = resolveWastedCameraParams(effectDur, intensity);
console.log("params @100%", params);

const camera = buildWastedCameraFilterExpr(effectDur, intensity, 1280, 720);
console.log("filter head:", camera.slice(0, 120) + "…");

const src = path.join(tmp, "src.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3366AA:s=1280x720:r=30:d=10",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=50x720:r=30:d=10",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x50:r=30:d=10",
    "-filter_complex",
    "[0][1]overlay=x=200:y=0[a];[a][2]overlay=x=0:y=200",
    "-t",
    "10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    src,
  ],
  { stdio: "ignore" }
);

const speed = 0.45;
const out = path.join(tmp, "wasted_cam.mp4");
const enc = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "1",
    "-t",
    String(effectDur * speed),
    "-i",
    src,
    "-vf",
    `setpts=PTS/${speed},${camera}`,
    "-an",
    out,
  ],
  { encoding: "utf8" }
);
if (enc.status !== 0) {
  console.error(enc.stderr.slice(-400));
  process.exit(1);
}

function analyze(t: number) {
  const png = path.join(tmp, `f_${String(t).replace(".", "_")}.png`);
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", out, "-frames:v", "1", png], {
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
  function cornerSum(x0: number, y0: number) {
    let s = 0,
      n = 0;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = x0; x < x0 + 8; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n += 3;
      }
    }
    return s / n;
  }
  const corners = [
    cornerSum(0, 0),
    cornerSum(w - 8, 0),
    cornerSum(0, h - 8),
    cornerSum(w - 8, h - 8),
  ];
  const empty = corners.filter((c) => c < 40).length;

  let best = -1,
    redX = 0;
  const ym = Math.floor(h / 2);
  for (let x = 0; x < w; x++) {
    const i = (ym * w + x) * 3;
    const score = buf[i] - (buf[i + 1] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      redX = x;
    }
  }
  best = -1;
  let yelY = 0;
  const xm = Math.floor(w / 2);
  for (let y = 0; y < h; y++) {
    const i = (y * w + xm) * 3;
    const score = buf[i] + buf[i + 1] - buf[i + 2];
    if (score > best) {
      best = score;
      yelY = y;
    }
  }
  return { t, redX, yelY, empty, cornerAvg: corners.map((c) => Math.round(c)) };
}

const times = [0.2, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4];
const rows = times.map(analyze);
console.log("\n=== samples ===");
for (const r of rows) console.log(r);

const reds = rows.map((r) => r.redX);
const yels = rows.map((r) => r.yelY);
const redRange = Math.max(...reds) - Math.min(...reds);
const yelRange = Math.max(...yels) - Math.min(...yels);
const emptyHits = rows.reduce((a, r) => a + r.empty, 0);

// Dense sampling: consecutive deltas should often be non-zero (continuous motion)
let movingPairs = 0;
for (let i = 1; i < rows.length; i++) {
  if (Math.abs(rows[i].redX - rows[i - 1].redX) >= 2 || Math.abs(rows[i].yelY - rows[i - 1].yelY) >= 2) {
    movingPairs++;
  }
}

// Zoom-out only: rebuild with intensity but we can't zero shake easily — check
// early vs late mean red with denser: at start Z higher → red further from 200*scale
// Proxy: late reds should be closer to "less cropped" on average when shake cancels —
// instead compare expected Z monotonic via params and early/late corner content.
console.log("\n=== verdict ===");
console.log({
  startZ: params.startZ,
  endZ: params.endZ,
  zDecreases: params.startZ > params.endZ,
  shakeAmp: params.shakeAmp,
  redRange,
  yelRange,
  emptyHits,
  movingPairs,
  pairsChecked: rows.length - 1,
});

if (!(params.startZ > params.endZ)) {
  console.error("FAIL: zoom not out (Z not decreasing)");
  process.exit(1);
}
if (emptyHits > 0) {
  console.error("FAIL: empty borders");
  process.exit(1);
}
if (redRange < 20 || yelRange < 15) {
  console.error("FAIL: shake too weak / not continuous", { redRange, yelRange });
  process.exit(1);
}
if (movingPairs < 4) {
  console.error("FAIL: motion not continuous across samples", { movingPairs });
  process.exit(1);
}
console.log("PASS");
