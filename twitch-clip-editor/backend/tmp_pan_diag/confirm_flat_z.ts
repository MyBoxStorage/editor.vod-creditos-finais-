import {
  buildZoomFilterExpr,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");
const z = 1.25;

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr7_${String(t).replace(".", "_")}.png`);
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

function measure(label: string, camera: string) {
  const out = path.join(tmp, `fx_${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "5",
      "-t",
      "2.7",
      "-i",
      landmark,
      "-vf",
      `setpts=PTS/0.45,${camera}`,
      "-an",
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", r.stderr.slice(-300));
    return;
  }
  const L = findRedCenterX(out, 1.08);
  const R = findRedCenterX(out, 3.0);
  console.log(label, `L=${L} R=${R} d=${R - L}`);
}

const flat: ZoomKeyframe[] = [
  { time: 0, scale: z, x: 50, y: 50 },
  { time: 1.08, scale: z, x: 42, y: 50 },
  { time: 2.04, scale: z, x: 50, y: 50 },
  { time: 3.0, scale: z, x: 58, y: 50 },
  { time: 3.96, scale: z, x: 50, y: 50 },
  { time: 6, scale: z, x: 50, y: 50 },
];

measure("old_flat", buildZoomFilterExpr(flat, 1280, 720));

// Constant-Z wasted-like with endpoints also at z (the fix)
const fixedWasted: ZoomKeyframe[] = [
  { time: 0, scale: z, x: 50, y: 50 },
  { time: 0.3, scale: z, x: 50, y: 50 },
  { time: 0.6, scale: z, x: 47.6, y: 50 },
  { time: 1.08, scale: z, x: 42, y: 50 },
  { time: 1.56, scale: z, x: 47.6, y: 50 },
  { time: 2.04, scale: z, x: 50, y: 50 },
  { time: 2.52, scale: z, x: 52.4, y: 50 },
  { time: 3, scale: z, x: 58, y: 50 },
  { time: 3.48, scale: z, x: 52.4, y: 50 },
  { time: 3.96, scale: z, x: 50, y: 50 },
  { time: 5.75, scale: z, x: 50, y: 50 },
  { time: 6, scale: z, x: 50, y: 50 },
];
measure("fixed_wasted_old_crop", buildZoomFilterExpr(fixedWasted, 1280, 720));

// Larger pan ±12
const bigPan: ZoomKeyframe[] = [
  { time: 0, scale: 1.4, x: 50, y: 50 },
  { time: 1.08, scale: 1.4, x: 38, y: 50 },
  { time: 2.04, scale: 1.4, x: 50, y: 50 },
  { time: 3.0, scale: 1.4, x: 62, y: 50 },
  { time: 3.96, scale: 1.4, x: 50, y: 50 },
  { time: 6, scale: 1.4, x: 50, y: 50 },
];
measure("big_pan", buildZoomFilterExpr(bigPan, 1280, 720));
