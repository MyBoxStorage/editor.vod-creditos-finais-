import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "roll_probe3");
fs.mkdirSync(tmp, { recursive: true });

const W = 1280,
  H = 720;
const src = path.join(tmp, "grid.mp4");
// Markers inward so they stay visible when slightly zoomed in
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x2266AA:s=${W}x${H}:r=30:d=8`,
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=16x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=16x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x12:r=30:d=8",
    "-filter_complex",
    "[0][1]overlay=x=400:y=0[a];[a][2]overlay=x=880:y=0[b];[b][3]overlay=x=0:y=354",
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

/** 0 → -A @0.22d → 0 @0.40d → +A @0.55d → 0 @d */
function angleExpr(d: number, A: number) {
  const t1 = d * 0.22;
  const t2 = d * 0.4;
  const t3 = d * 0.55;
  return (
    `if(lt(t\\,${t1})\\,${-A}*t/${t1}\\,` +
    `if(lt(t\\,${t2})\\,${-A}+${A}*(t-${t1})/${t2 - t1}\\,` +
    `if(lt(t\\,${t3})\\,${A}*(t-${t2})/${t3 - t2}\\,` +
    `${A}*(1-(t-${t3})/${d - t3}))))`
  );
}

function buildFilter(startS: number, endS: number, A: number, d: number) {
  const sExpr = `${startS}+(${endS}-${startS})*min(t\\,${d})/${d}`;
  const aExpr = angleExpr(d, A);
  return [
    `scale=w='max(2\\,trunc(iw*(${sExpr})/2)*2)':h='max(2\\,trunc(ih*(${sExpr})/2)*2)':eval=frame`,
    `rotate=a='(${aExpr})*PI/180':ow=iw:oh=ih:c=black`,
    `crop=${W}:${H}:(iw-${W})/2:(ih-${H})/2`,
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
    console.log(label, "FAIL", r.stderr.slice(-400));
    return null;
  }
  return out;
}

function analyze(file: string, t: number) {
  const png = path.join(tmp, `f_${String(t).replace(".", "_")}.png`);
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
    for (let y = y0; y < y0 + 10; y++)
      for (let x = x0; x < x0 + 10; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
    return s / n;
  }
  const corners = [
    cornerSum(0, 0),
    cornerSum(w - 10, 0),
    cornerSum(0, h - 10),
    cornerSum(w - 10, h - 10),
  ];
  const empty = corners.filter((c) => c < 25).length;
  const yMid = Math.floor(h / 2);
  let redX = 0,
    limeX = 0,
    bestR = -1e9,
    bestL = -1e9;
  for (let x = 0; x < w; x++) {
    const i = (yMid * w + x) * 3;
    const R = buf[i],
      G = buf[i + 1],
      B = buf[i + 2];
    if (R - G - B > bestR) {
      bestR = R - G - B;
      redX = x;
    }
    if (G - R - B > bestL) {
      bestL = G - R - B;
      limeX = x;
    }
  }
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
  return {
    t,
    markerDist: limeX - redX,
    tiltPx: yellowY(Math.floor(w * 0.8)) - yellowY(Math.floor(w * 0.2)),
    empty,
    corners: corners.map((c) => Math.round(c)),
    redX,
    limeX,
  };
}

const d = 6;
const A = 2.5;
const endS = 1.0;
const need = overscan(A) * 1.03;
// Constraint at right peak t=0.55d
const startS = Math.max(1 / 0.93, (need - endS * (1 - 0.55)) / 0.55);
console.log({
  A,
  need,
  startS,
  endS,
  S_at_right: startS + (endS - startS) * 0.55,
  fovGainPct: (((1 / endS - 1 / startS) / (1 / startS)) * 100).toFixed(1),
});

const out = encode("cam", `setpts=PTS/0.45,${buildFilter(startS, endS, A, d)}`);
if (!out) process.exit(1);

const times = [0.15, 1.32, 2.4, 3.3, 5.9]; // ~0, left, center, right, end
const rows = times.map((t) => analyze(out, t));
console.log("=== roll+zoom ===");
for (const r of rows) console.log(r);

const outZ = encode("z", `setpts=PTS/0.45,${buildFilter(startS, endS, 0, d)}`);
const early = analyze(outZ!, 0.2);
const late = analyze(outZ!, 5.7);
console.log("=== zoom only ===");
console.log("early", early);
console.log("late", late);
const zoomDelta = late.markerDist - early.markerDist;
console.log("markerDist delta (ZOOM OUT ⇒ negative):", zoomDelta);

const emptyHits = rows.reduce((a, r) => a + r.empty, 0);
const tilts = rows.map((r) => r.tiltPx);
const ok =
  emptyHits === 0 &&
  zoomDelta < -20 &&
  tilts[1] < -10 &&
  Math.abs(tilts[2]) < 10 &&
  tilts[3] > 10 &&
  Math.abs(tilts[4]) < 12;

console.log("PASS?", ok, { emptyHits, zoomDelta, tilts });
process.exit(ok ? 0 : 1);
