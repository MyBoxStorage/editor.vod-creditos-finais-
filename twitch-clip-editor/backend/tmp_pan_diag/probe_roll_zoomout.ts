/**
 * Calibrate overscan vs angle, then verify zoom-OUT direction (marker distance
 * must DECREASE) and roll without empty borders — before wiring into production.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "roll_probe");
fs.mkdirSync(tmp, { recursive: true });

const src = path.join(tmp, "grid.mp4");
// Blue bg, red bar @x=100, green bar @x=1180, yellow bar @y=360 (full width)
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x2266AA:s=1280x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=20x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=20x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x16:r=30:d=8",
    "-filter_complex",
    "[0][1]overlay=x=100:y=0[a];[a][2]overlay=x=1180:y=0[b];[b][3]overlay=x=0:y=352",
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

function overscan(deg: number) {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return Math.abs(Math.cos(r)) + Math.abs(Math.sin(r));
}

/** Piecewise angle: 0 → -A → 0 → +A → 0 */
function angleExpr(d: number, A: number) {
  const p1 = d * 0.25;
  const p2 = d * 0.5;
  const p3 = d * 0.75;
  // degrees
  return (
    `if(lt(t\\,${p1})\\,${-A}*t/${p1}\\,` +
    `if(lt(t\\,${p2})\\,${-A}+${A}*(t-${p1})/${p2 - p1}\\,` +
    `if(lt(t\\,${p3})\\,${A}*(t-${p2})/${p3 - p2}\\,` +
    `${A}-${A}*(t-${p3})/${d - p3})))`
  );
}

function buildFilter(startS: number, endS: number, A: number, d: number, outW = 1280, outH = 720) {
  const sExpr = `${startS}+(${endS}-${startS})*min(t\\,${d})/${d}`;
  const aExpr = angleExpr(d, A);
  // Scale up → rotate (bbox grows) → center-crop to output. No pad fill.
  return [
    `scale=w='max(2\\,trunc(iw*(${sExpr})/2)*2)':h='max(2\\,trunc(ih*(${sExpr})/2)*2)':eval=frame`,
    `rotate=a='(${aExpr})*PI/180':ow=rotw(a):oh=roth(a):c=none`,
    `crop=${outW}:${outH}:(iw-${outW})/2:(ih-${outH})/2`,
  ].join(",");
}

function encode(label: string, vf: string) {
  const out = path.join(tmp, `${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", src, "-t", "6", "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", r.stderr.slice(-500));
    return null;
  }
  return out;
}

function analyze(file: string, t: number) {
  const png = path.join(tmp, `f_${labelSafe(t)}.png`);
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

  function cornerSum(x0: number, y0: number) {
    let s = 0,
      n = 0;
    for (let y = y0; y < y0 + 10; y++) {
      for (let x = x0; x < x0 + 10; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
    }
    return s / n;
  }
  const corners = [
    cornerSum(0, 0),
    cornerSum(w - 10, 0),
    cornerSum(0, h - 10),
    cornerSum(w - 10, h - 10),
  ];
  // Empty = near black (pad/rotate fill). Blue bg ~ sum 170+
  const empty = corners.filter((c) => c < 25).length;

  // Find red (left) and lime (right) bar X at mid row
  const yMid = Math.floor(h / 2);
  let redX = -1,
    limeX = -1,
    bestR = -1e9,
    bestL = -1e9;
  for (let x = 0; x < w; x++) {
    const i = (yMid * w + x) * 3;
    const R = buf[i],
      G = buf[i + 1],
      B = buf[i + 2];
    const redScore = R - G - B;
    const limeScore = G - R - B;
    if (redScore > bestR) {
      bestR = redScore;
      redX = x;
    }
    if (limeScore > bestL) {
      bestL = limeScore;
      limeX = x;
    }
  }
  const markerDist = limeX - redX; // decreases when zooming OUT

  // Yellow bar tilt: Y of max yellow-ish at x=left and x=right
  function yellowY(x: number) {
    let best = -1e9,
      yy = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 3;
      const score = buf[i] + buf[i + 1] - 2 * buf[i + 2];
      if (score > best) {
        best = score;
        yy = y;
      }
    }
    return yy;
  }
  const yL = yellowY(Math.floor(w * 0.2));
  const yR = yellowY(Math.floor(w * 0.8));
  const tiltPx = yR - yL; // nonzero when rolled

  return {
    t,
    markerDist,
    tiltPx,
    empty,
    cornerAvg: corners.map((c) => Math.round(c)),
    redX,
    limeX,
  };
}

function labelSafe(t: number) {
  return String(t).replace(".", "_");
}

// --- Choose startS so S(3d/4) >= overscan(A) with endS=1 ---
const d = 6;
const A = 2.5;
const endS = 1.0;
const need = overscan(A) * 1.02; // small safety
// startS + (endS-startS)*0.75 >= need  →  startS*0.25 + 0.75 >= need
const startSMin = (need - 0.75) / 0.25;
const startS = Math.max(1 / 0.93, startSMin); // honor original ~7% pullback minimum
console.log({ A, overscan: overscan(A), need, startSMin, startS, endS });

const vf = `setpts=PTS/0.45,${buildFilter(startS, endS, A, d)}`;
const out = encode("roll", vf);
if (!out) process.exit(1);

const times = [0.15, 1.5, 3.0, 4.5, 5.85];
const rows = times.map((t) => analyze(out, t));
console.log("\n=== with roll ===");
for (const r of rows) console.log(r);

// Zoom-only (A=0) to prove FOV direction
const outZ = encode("zoomonly", `setpts=PTS/0.45,${buildFilter(startS, endS, 0, d)}`);
const zEarly = analyze(outZ!, 0.2);
const zLate = analyze(outZ!, 5.7);
console.log("\n=== zoom only ===");
console.log("early", zEarly);
console.log("late", zLate);
console.log("markerDist delta (must be <0 for zoom OUT):", zLate.markerDist - zEarly.markerDist);

const emptyHits = rows.reduce((a, r) => a + r.empty, 0);
const tilts = rows.map((r) => r.tiltPx);
const hasLeft = tilts.some((t) => t < -8);
const hasRight = tilts.some((t) => t > 8);
const hasCenterNearEnd = Math.abs(rows[rows.length - 1].tiltPx) < 8;

console.log("\nCHECKS", {
  emptyHits,
  hasLeft,
  hasRight,
  hasCenterNearEnd,
  zoomOut: zLate.markerDist < zEarly.markerDist - 20,
  tilts,
});

if (emptyHits > 0 || !hasLeft || !hasRight || !(zLate.markerDist < zEarly.markerDist - 20)) {
  console.error("PROBE FAILED");
  process.exit(1);
}
console.log("PROBE PASS");
