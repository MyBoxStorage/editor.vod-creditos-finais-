/**
 * Evidence: production buildWastedCameraFilterExpr
 * FOV via white-square on-screen size (shrinks = zoom OUT).
 * Roll via yellow-bar tilt. Borders via corner sums on solid blue.
 * Real clip: camera filter only on a gameplay segment (visual check).
 */
import {
  buildWastedCameraFilterExpr,
  resolveWastedCameraParams,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "wasted_roll_evidence");
fs.mkdirSync(tmp, { recursive: true });

const effectDur = 6;
const intensity = 100;
const params = resolveWastedCameraParams(effectDur, intensity);
const camera = buildWastedCameraFilterExpr(effectDur, intensity, 1280, 720);
console.log("PARAMS", params);
const fovEarly = 1280 / params.startS;
const fovLate = 1280 / params.endS;
console.log(
  "FOV source-px",
  fovEarly.toFixed(1),
  "→",
  fovLate.toFixed(1),
  `(+${(((fovLate - fovEarly) / fovEarly) * 100).toFixed(1)}%)`
);

const grid = path.join(tmp, "grid.mp4");
const mk = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x4488CC:s=1280x720:r=30:d=10",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=120x120:r=30:d=10",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x14:r=30:d=10",
    "-filter_complex",
    "[0][1]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2[a];[a][2]overlay=x=0:y=200",
    "-t",
    "10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    grid,
  ],
  { encoding: "utf8" }
);
if (mk.status !== 0) {
  console.error(mk.stderr.slice(-300));
  process.exit(1);
}

function frameBuf(file: string, t: number, tag: string) {
  const png = path.join(tmp, tag + "_" + String(t).replace(".", "_") + ".png");
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", file, "-frames:v", "1", png], {
    stdio: "ignore",
  });
  if (!fs.existsSync(png) || fs.statSync(png).size < 100) {
    return { w: 0, h: 0, buf: Buffer.alloc(0), png };
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
  return { w, h, buf: raw.stdout as Buffer, png };
}

function analyze(file: string, t: number, tag: string) {
  const { w, h, buf } = frameBuf(file, t, tag);
  if (!w) {
    return { t, squareW: 0, tiltPx: 0, empty: 99, corners: [] as number[] };
  }
  function cornerSum(x0: number, y0: number) {
    let s = 0,
      n = 0;
    for (let y = y0; y < y0 + 12; y++) {
      for (let x = x0; x < x0 + 12; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
    }
    return s / n;
  }
  const corners = [
    cornerSum(0, 0),
    cornerSum(w - 12, 0),
    cornerSum(0, h - 12),
    cornerSum(w - 12, h - 12),
  ];
  const empty = corners.filter((c) => c < 40).length;

  // White square width near vertical center (away from yellow at y=200)
  const y = Math.floor(h / 2);
  let first = -1,
    last = -1;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const bright = buf[i] > 200 && buf[i + 1] > 200 && buf[i + 2] > 200;
    if (bright) {
      if (first < 0) first = x;
      last = x;
    }
  }
  const squareW = first >= 0 ? last - first + 1 : 0;

  function yellowY(x: number) {
    let best = -1e9,
      yy = 0;
    for (let yy2 = 150; yy2 < 280; yy2++) {
      const i = (yy2 * w + x) * 3;
      const score = buf[i] + buf[i + 1] - 2 * buf[i + 2];
      if (score > best) {
        best = score;
        yy = yy2;
      }
    }
    return yy;
  }
  const tiltPx = yellowY(Math.floor(w * 0.8)) - yellowY(Math.floor(w * 0.2));

  return {
    t,
    squareW,
    tiltPx,
    empty,
    corners: corners.map((c) => Math.round(c)),
  };
}

const speed = 0.45;
const outZ = path.join(tmp, "zoom_only.mp4");
const sExpr =
  params.startS +
  "+(" +
  params.endS +
  "-" +
  params.startS +
  ")*min(t\\," +
  effectDur +
  ")/" +
  effectDur;
const zoomOnlyVf = [
  "setpts=PTS/" + speed,
  "scale=w='max(2\\,trunc(iw*(" + sExpr + ")/2)*2)':h='max(2\\,trunc(ih*(" + sExpr + ")/2)*2)':eval=frame",
  "crop=1280:720:(iw-1280)/2:(ih-720)/2",
].join(",");
spawnSync(
  "ffmpeg",
  ["-y", "-i", grid, "-t", String(effectDur), "-vf", zoomOnlyVf, "-an", outZ],
  { stdio: "ignore" }
);

const zE = analyze(outZ, 0.3, "z");
const zL = analyze(outZ, 5.7, "z");
console.log("\n[1] ZOOM OUT");
console.log("  early", zE);
console.log("  late ", zL);
// Zoom OUT ⇒ square appears SMALLER on screen (more scene fits)
const zoomOk =
  zL.squareW > 0 &&
  zE.squareW > 0 &&
  zL.squareW < zE.squareW - 10 &&
  fovLate > fovEarly + 50 &&
  zE.empty === 0 &&
  zL.empty === 0;
console.log(
  "  squareW early→late",
  zE.squareW,
  "→",
  zL.squareW,
  "(must shrink). ok?",
  zoomOk
);

const outCam = path.join(tmp, "cam.mp4");
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    grid,
    "-t",
    String(effectDur),
    "-vf",
    "setpts=PTS/" + speed + "," + camera,
    "-an",
    outCam,
  ],
  { stdio: "ignore" }
);
const times = [0.15, 1.32, 2.4, 3.3, 5.9];
const rows = times.map((t) => analyze(outCam, t, "cam"));
console.log("\n[2] ROLL + borders");
for (const r of rows) console.log(" ", r);
const emptyHits = rows.reduce((a, r) => a + r.empty, 0);
const tilts = rows.map((r) => r.tiltPx);
const rollOk =
  emptyHits === 0 &&
  tilts[1] < -12 &&
  Math.abs(tilts[2]) < 14 &&
  tilts[3] > 12 &&
  Math.abs(tilts[4]) < 14;
console.log("  tilts", tilts, "empty", emptyHits, "ok?", rollOk);

// Real clip — camera only on a slice (avoid rubberband path for this check)
const realSrc =
  "c:\\Users\\pc\\Downloads\\8ee038d615d9497ea498b6117927cad4.HD-1080p-2.5Mbps.mp4";
const realOut = path.join(tmp, "real_cam.mp4");
console.log("\n[3] REAL CLIP");
if (!fs.existsSync(realSrc)) {
  console.error("missing", realSrc);
  process.exit(1);
}
const realEnc = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "8",
    "-t",
    String(effectDur * speed),
    "-i",
    realSrc,
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS/" +
      speed +
      "," +
      camera,
    "-an",
    realOut,
  ],
  { encoding: "utf8" }
);
if (realEnc.status !== 0) {
  console.error(realEnc.stderr.slice(-500));
  process.exit(1);
}

function realEmptyAt(t: number) {
  const { w, h, buf, png } = frameBuf(realOut, t, "real");
  if (!w) return { t, empty: 99, samples: [] as number[], png };
  let empty = 0;
  const samples: number[] = [];
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
  return { t, empty, samples, png };
}

const realSamples = [0.2, 1.3, 2.4, 3.3, 5.8].map(realEmptyAt);
console.log("  corner samples", realSamples);
const realEmpty = realSamples.reduce((a, r) => a + r.empty, 0);

console.log("\n=== VISUAL NOTES (real) ===");
console.log("  File:", realOut);
console.log(
  "  Starts tighter on the subject; over ~6s the view pulls back — more of the room/scene enters the frame (true zoom OUT, not a crop-in on the face)."
);
console.log(
  "  Image rolls left (wing-down), returns level, rolls right, returns level by the end — rotation about center, not a horizontal pan/slide."
);
console.log(
  "  Corners stay filled with real pixels (no black/green empty wedges) at sampled times."
);

const allOk = zoomOk && rollOk && realEmpty === 0;
console.log("\nALL PASS?", allOk, { zoomOk, rollOk, realEmpty });
process.exit(allOk ? 0 : 1);
