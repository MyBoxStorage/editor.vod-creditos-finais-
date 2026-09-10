import {
  buildWastedZoomKeyframes,
  buildZoomFilterExpr,
  colorPresetFilterExpr,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

const tmp = path.join(__dirname);
fs.mkdirSync(tmp, { recursive: true });

const effectDur = 6;
const intensity = 100;
const speed = 0.45;
const sourceSeconds = effectDur * speed;

const kfs = buildWastedZoomKeyframes(effectDur, intensity);
console.log(
  "keyframes x:",
  kfs.map((k) => `${k.time}:x=${k.x}:z=${k.scale}`).join(" | ")
);

const camera = buildZoomFilterExpr(kfs, 1280, 720);
console.log("camera filter length:", camera.length);

const color = colorPresetFilterExpr("wasted_grayscale", intensity, {
  start: 0,
  end: effectDur,
  fadeSeconds: 0.25,
});
console.log("color:", color);

// Chessboard source 20s
const board = path.join(tmp, "board.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1280x720:r=30:d=20",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    board,
  ],
  { stdio: "ignore" }
);

// Mimic production order: setpts then camera (current)
const vfCurrent = `setpts=PTS/${speed},${camera}`;
const outCurrent = path.join(tmp, "wasted_current.mp4");
let r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "10",
    "-t",
    String(sourceSeconds),
    "-i",
    board,
    "-vf",
    vfCurrent,
    "-an",
    outCurrent,
  ],
  { encoding: "utf8" }
);
console.log("current encode", r.status === 0 ? "OK" : r.stderr.slice(-500));

function sample(file: string, t: number) {
  const png = path.join(tmp, `s_${t}.png`);
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
  // Fingerprint: mean of left 8% and a vertical edge energy score
  function meanRegion(x0: number, x1: number, y0: number, y1: number) {
    let s = 0,
      n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n += 3;
      }
    }
    return s / n;
  }
  const left = meanRegion(0, Math.floor(w * 0.08), Math.floor(h * 0.3), Math.floor(h * 0.7));
  const mid = meanRegion(
    Math.floor(w * 0.46),
    Math.floor(w * 0.54),
    Math.floor(h * 0.3),
    Math.floor(h * 0.7)
  );
  // Find brightest column (testsrc2 has moving patterns - use static gradient instead?)
  return { left: Number(left.toFixed(1)), mid: Number(mid.toFixed(1)), w, h };
}

// Better: use a static unique landmark - color bars again OR drawtext grid
// Remake with a fixed asymmetric pattern: left red strip
const landmark = path.join(tmp, "landmark.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x224466:s=1280x720:r=30:d=20",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=80x720:r=30:d=20",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=80x720:r=30:d=20",
    "-filter_complex",
    "[0][1]overlay=x=200:y=0[a];[a][2]overlay=x=1000:y=0",
    "-t",
    "20",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    landmark,
  ],
  { stdio: "ignore" }
);

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr_${t}.png`);
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
    const score = buf[i] - buf[i + 1] - buf[i + 2]; // red-ish
    if (score > best) {
      best = score;
      bestX = x;
    }
  }
  return bestX;
}

for (const label of ["current"] as const) {
  const out = path.join(tmp, `wasted_${label}.mp4`);
  const vf =
    label === "current"
      ? `setpts=PTS/${speed},${camera}`
      : `setpts=(PTS-STARTPTS)/${speed},${camera}`;
  r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "5",
      "-t",
      String(sourceSeconds),
      "-i",
      landmark,
      "-vf",
      vf,
      "-an",
      out,
    ],
    { encoding: "utf8" }
  );
  console.log(label, r.status === 0 ? "OK" : r.stderr.slice(-400));

  // Sample at left peak (~1.08), center (~2.04), right peak (~3.0), hold (~5)
  const times = [1.08, 2.04, 3.0, 5.0];
  const xs = times.map((t) => findRedCenterX(out, t));
  console.log(
    label,
    "redX@",
    times.map((t, i) => `${t}=${xs[i]}`).join(" "),
    "delta L→R",
    xs[2] - xs[0]
  );
}
