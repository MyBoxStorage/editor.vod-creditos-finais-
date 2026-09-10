import {
  buildZoomFilterExpr,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr2_${String(t).replace(".", "_")}.png`);
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

function encodeAndMeasure(label: string, kfs: ZoomKeyframe[]) {
  const camera = buildZoomFilterExpr(kfs, 1280, 720);
  const out = path.join(tmp, `n_${label}.mp4`);
  const speed = 0.45;
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "5",
      "-t",
      String(6 * speed),
      "-i",
      landmark,
      "-vf",
      `setpts=PTS/${speed},${camera}`,
      "-an",
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", camera.length, r.stderr.slice(-200));
    return;
  }
  const L = findRedCenterX(out, 1.08);
  const R = findRedCenterX(out, 3.0);
  console.log(label, "kfs", kfs.length, "flen", camera.length, "L", L, "R", R, "d", R - L);
}

const z = 1.25;
const pan = 8;

// progressive keyframe counts along wasted path
for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  const times = Array.from({ length: n }, (_, i) => (6 * i) / (n - 1));
  // alternate toward left then right
  const kfs: ZoomKeyframe[] = times.map((t, i) => {
    const phase = i / (n - 1);
    let x = 50;
    if (phase < 0.35) x = 50 - pan * (phase / 0.35);
    else if (phase < 0.5) x = 50 - pan * (1 - (phase - 0.35) / 0.15);
    else if (phase < 0.75) x = 50 + pan * ((phase - 0.5) / 0.25);
    else x = 50 + pan * (1 - (phase - 0.75) / 0.25);
    return { time: Number(t.toFixed(3)), scale: z, x: Number(x.toFixed(3)), y: 50 };
  });
  encodeAndMeasure(`n${n}`, kfs);
}

// constant Z, wasted-like 12 points but scale always 1.25 (no scale animation)
const wastedFlat: ZoomKeyframe[] = [
  [0, 50],
  [0.3, 50],
  [0.6, 47.6],
  [1.08, 42],
  [1.56, 47.6],
  [2.04, 50],
  [2.52, 52.4],
  [3, 58],
  [3.48, 52.4],
  [3.96, 50],
  [5.75, 50],
  [6, 50],
].map(([t, x]) => ({ time: t, scale: z, x, y: 50 }));
encodeAndMeasure("flat12", wastedFlat);

// few keyframes matching path peaks only
const peaks: ZoomKeyframe[] = [
  { time: 0, scale: 1, x: 50, y: 50 },
  { time: 0.3, scale: z, x: 50, y: 50 },
  { time: 1.08, scale: z, x: 42, y: 50 },
  { time: 2.04, scale: z, x: 50, y: 50 },
  { time: 3.0, scale: z, x: 58, y: 50 },
  { time: 3.96, scale: z, x: 50, y: 50 },
  { time: 5.75, scale: z, x: 50, y: 50 },
  { time: 6, scale: 1, x: 50, y: 50 },
];
encodeAndMeasure("peaks8", peaks);
