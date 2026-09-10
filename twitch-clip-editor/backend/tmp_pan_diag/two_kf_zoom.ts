import {
  buildZoomFilterExpr,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr8_${String(t).replace(".", "_")}.png`);
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

function measure(label: string, kfs: ZoomKeyframe[]) {
  const camera = buildZoomFilterExpr(kfs, 1280, 720);
  const out = path.join(tmp, `h2_${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "5",
      "-t",
      "3",
      "-i",
      landmark,
      "-vf",
      camera,
      "-an",
      out,
    ],
    { encoding: "utf8" }
  );
  console.log(
    label,
    r.status === 0
      ? [0.1, 1.5, 2.9].map((t) => `${t}:${findRedCenterX(out, t)}`).join(" ")
      : "FAIL"
  );
}

// 2-kf zoom in (like hook) — does animated Z work with only 2 keyframes?
measure("zoom2", [
  { time: 0, scale: 1, x: 50, y: 50 },
  { time: 3, scale: 1.25, x: 50, y: 50 },
]);

// 2-kf zoom + pan
measure("zoom2pan", [
  { time: 0, scale: 1, x: 42, y: 50 },
  { time: 3, scale: 1.25, x: 58, y: 50 },
]);
