import { buildWastedCameraFilterExpr } from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "wasted_roll_evidence");
fs.mkdirSync(tmp, { recursive: true });
const camera = buildWastedCameraFilterExpr(6, 100, 1280, 720);
const src = "c:/Users/pc/Downloads/Clypse_Streamer_Receitade4.mp4";
const base = path.join(tmp, "real_base.mp4");
const out = path.join(tmp, "real_cam.mp4");

let r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "10",
    "-t",
    "2.7",
    "-i",
    src,
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-an",
    base,
  ],
  { encoding: "utf8" }
);
console.log("base", r.status, fs.existsSync(base) ? fs.statSync(base).size : 0);
if (r.status !== 0) console.log(r.stderr.slice(-400));

r = spawnSync(
  "ffmpeg",
  ["-y", "-i", base, "-vf", "setpts=PTS/0.45," + camera, "-t", "6", "-an", out],
  { encoding: "utf8" }
);
console.log("cam", r.status, fs.existsSync(out) ? fs.statSync(out).size : 0);
if (r.status !== 0) console.log(r.stderr.slice(-500));

function corners(t: number) {
  const png = path.join(tmp, "rv_" + t + ".png");
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", out, "-frames:v", "1", png], {
    stdio: "ignore",
  });
  if (!fs.existsSync(png) || fs.statSync(png).size < 100) {
    return { t, empty: 99, samples: [] as number[] };
  }
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
  const samples: number[] = [];
  let empty = 0;
  for (const [x0, y0] of [
    [0, 0],
    [w - 8, 0],
    [0, h - 8],
    [w - 8, h - 8],
  ] as const) {
    let s = 0,
      n = 0;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = x0; x < x0 + 8; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
    }
    const avg = s / n;
    samples.push(Math.round(avg));
    if (avg < 12) empty++;
  }
  return { t, empty, samples };
}

for (const t of [0.2, 1.3, 2.4, 3.3, 5.8]) {
  console.log(corners(t));
}
console.log("out", out);
