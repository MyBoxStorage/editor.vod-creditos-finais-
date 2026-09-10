/**
 * Probe: does monotonic zoom-out (Z decreasing) + continuous sin shake
 * work with ffmpeg crop, without nested keyframe ifs?
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "zoomout_probe");
fs.mkdirSync(tmp, { recursive: true });

const src = path.join(tmp, "grid.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=s=1280x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=40x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=1280x40:r=30:d=8",
    "-filter_complex",
    "[0][1]overlay=x=200:y=0[a];[a][2]overlay=x=0:y=200",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    src,
  ],
  { stdio: "ignore" }
);

const d = 6;
const startZ = 1.16;
const endZ = 1.075;
const amp = 2.5; // percent
// Monotonic Z + continuous sin shake (closed-form, no nested ifs)
const zExpr = `${startZ}+(${endZ}-${startZ})*min(t\\,${d})/${d}`;
const xExpr = `50+${amp}*sin(2*PI*t/1.8)`;
const yExpr = `50+${amp * 0.7}*sin(2*PI*t/2.3+1.2)`;
const camera =
  `crop=w='iw/(${zExpr})':h='ih/(${zExpr})':` +
  `x='iw*(${xExpr})/100-(iw/(${zExpr}))/2':` +
  `y='ih*(${yExpr})/100-(ih/(${zExpr}))/2',` +
  `scale=1280:720`;

const out = path.join(tmp, "out.mp4");
const enc = spawnSync(
  "ffmpeg",
  ["-y", "-i", src, "-t", String(d), "-vf", `setpts=PTS/0.45,${camera}`, "-an", out],
  { encoding: "utf8" }
);
console.log("encode", enc.status === 0 ? "OK" : enc.stderr.slice(-400));

function frameStats(t: number) {
  const png = path.join(tmp, `f_${t}.png`);
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
  // Corner blackness (border check)
  function pix(x: number, y: number) {
    const i = (y * w + x) * 3;
    return [buf[i], buf[i + 1], buf[i + 2]] as const;
  }
  const corners = [
    pix(2, 2),
    pix(w - 3, 2),
    pix(2, h - 3),
    pix(w - 3, h - 3),
  ];
  const blackCorners = corners.filter(([r, g, b]) => r + g + b < 30).length;

  // Red strip X (vertical landmark)
  const yMid = Math.floor(h / 2);
  let best = -1,
    redX = 0;
  for (let x = 0; x < w; x++) {
    const i = (yMid * w + x) * 3;
    const score = buf[i] - (buf[i + 1] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      redX = x;
    }
  }
  // Lime strip Y (horizontal landmark)
  const xMid = Math.floor(w / 2);
  best = -1;
  let limeY = 0;
  for (let y = 0; y < h; y++) {
    const i = (y * w + xMid) * 3;
    const score = buf[i + 1] - (buf[i] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      limeY = y;
    }
  }
  // Zoom proxy: how far red is from where it would be at Z=1 (x=200)
  // After crop Z and scale to full, red moves based on Z and pan.
  return { t, redX, limeY, blackCorners };
}

const times = [0.2, 1.0, 2.0, 3.0, 4.0, 5.5];
const rows = times.map(frameStats);
console.log("samples:");
for (const r of rows) console.log(r);

const redXs = rows.map((r) => r.redX);
const limeYs = rows.map((r) => r.limeY);
const redRange = Math.max(...redXs) - Math.min(...redXs);
const limeRange = Math.max(...limeYs) - Math.min(...limeYs);
const anyBorder = rows.some((r) => r.blackCorners > 0);
console.log({
  redRange,
  limeRange,
  anyBorder,
  // Monotonic zoom-out: red landmark should drift as Z changes even with shake;
  // shake alone also moves it — check that early vs late framing differs beyond shake amp
  earlyRed: redXs[0],
  lateRed: redXs[redXs.length - 1],
});
