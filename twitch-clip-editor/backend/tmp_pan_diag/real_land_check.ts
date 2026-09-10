import { buildWastedCameraFilterExpr } from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "wasted_roll_evidence");
const camera = buildWastedCameraFilterExpr(6, 100, 1280, 720);
// Landscape gameplay — no letterbox black bars at corners
const src = "c:/Users/pc/Downloads/streamladder-2824968543-2522-2580.mp4";
const base = path.join(tmp, "real_land_base.mp4");
const out = path.join(tmp, "real_land_cam.mp4");

let r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "5",
    "-t",
    "2.7",
    "-i",
    src,
    "-vf",
    "scale=1280:720,setsar=1",
    "-an",
    base,
  ],
  { encoding: "utf8" }
);
console.log("base", r.status, fs.statSync(base).size);
if (r.status !== 0) {
  console.log(r.stderr.slice(-400));
  process.exit(1);
}

r = spawnSync(
  "ffmpeg",
  ["-y", "-i", base, "-vf", "setpts=PTS/0.45," + camera, "-t", "6", "-an", out],
  { encoding: "utf8" }
);
console.log("cam", r.status, fs.statSync(out).size);
if (r.status !== 0) {
  console.log(r.stderr.slice(-400));
  process.exit(1);
}

function sample(t: number) {
  const png = path.join(tmp, "rl_" + t + ".png");
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
  function at(x: number, y: number) {
    const i = (y * w + x) * 3;
    return buf[i] + buf[i + 1] + buf[i + 2];
  }
  const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
  const mid = at((w / 2) | 0, (h / 2) | 0);
  const empty = corners.filter((c) => c < 12).length;
  return { t, corners, mid, empty };
}

let totalEmpty = 0;
for (const t of [0.2, 1.3, 2.4, 3.3, 5.8]) {
  const s = sample(t);
  totalEmpty += s.empty;
  console.log(s);
}
console.log("PASS borders?", totalEmpty === 0, "out=", out);
process.exit(totalEmpty === 0 ? 0 : 1);
