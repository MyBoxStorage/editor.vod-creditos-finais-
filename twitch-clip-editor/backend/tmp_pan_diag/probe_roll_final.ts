import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "roll_final_probe");
fs.mkdirSync(tmp, { recursive: true });
const W = 1280;
const H = 720;
const src = path.join(tmp, "grid.mp4");

const mk = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x4488CC:s=1280x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=24x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=lime:s=24x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x14:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=60x60:r=30:d=8",
    "-filter_complex",
    [
      "[0][1]overlay=x=500:y=0[a]",
      "[a][2]overlay=x=780:y=0[b]",
      "[b][3]overlay=x=0:y=353[c]",
      "[c][4]overlay=x=20:y=20[d]",
      "[d][4]overlay=x=1200:y=20[e]",
      "[e][4]overlay=x=20:y=640[f]",
      "[f][4]overlay=x=1200:y=640",
    ].join(";"),
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    src,
  ],
  { encoding: "utf8" }
);
if (mk.status !== 0) {
  console.log("src FAIL", mk.stderr.slice(-400));
  process.exit(1);
}

function overscan(deg: number) {
  const rad = (Math.abs(deg) * Math.PI) / 180;
  return Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
}

function angleExpr(d: number, A: number) {
  const t1 = d * 0.22;
  const t2 = d * 0.4;
  const t3 = d * 0.55;
  return (
    "if(lt(t\\," +
    t1 +
    ")\\," +
    -A +
    "*t/" +
    t1 +
    "\\," +
    "if(lt(t\\," +
    t2 +
    ")\\," +
    -A +
    "+" +
    A +
    "*(t-" +
    t1 +
    ")/" +
    (t2 - t1) +
    "\\," +
    "if(lt(t\\," +
    t3 +
    ")\\," +
    A +
    "*(t-" +
    t2 +
    ")/" +
    (t3 - t2) +
    "\\," +
    A +
    "*(1-(t-" +
    t3 +
    ")/" +
    (d - t3) +
    "))))"
  );
}

function buildFilter(startS: number, endS: number, A: number, d: number) {
  const s0 = Number(startS.toFixed(4));
  const s1 = Number(endS.toFixed(4));
  const sExpr = s0 + "+(" + s1 + "-" + s0 + ")*min(t\\," + d + ")/" + d;
  const aExpr = angleExpr(d, A);
  return [
    "scale=w='max(2\\,trunc(iw*(" + sExpr + ")/2)*2)':h='max(2\\,trunc(ih*(" + sExpr + ")/2)*2)':eval=frame",
    "rotate=a='(" + aExpr + ")*PI/180':ow=iw:oh=ih:c=black",
    "crop=" + W + ":" + H + ":(iw-" + W + ")/2:(ih-" + H + ")/2",
  ].join(",");
}

function encode(label: string, vf: string) {
  const out = path.join(tmp, label + ".mp4");
  const er = spawnSync(
    "ffmpeg",
    ["-y", "-i", src, "-t", "6", "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  if (er.status !== 0) {
    console.log(label, "FAIL", er.stderr.slice(-400));
    return null;
  }
  return out;
}

function analyze(file: string, t: number) {
  const png = path.join(tmp, "f_" + String(t).replace(".", "_") + ".png");
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
  const parts = p.stdout.trim().split(",");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  const raw = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: null, maxBuffer: 20e6 }
  );
  const buf = raw.stdout as Buffer;

  function regionMean(x0: number, y0: number, s: number) {
    let R = 0,
      G = 0,
      B = 0,
      n = 0;
    for (let y = y0; y < y0 + s; y++) {
      for (let x = x0; x < x0 + s; x++) {
        const i = (y * w + x) * 3;
        R += buf[i];
        G += buf[i + 1];
        B += buf[i + 2];
        n++;
      }
    }
    return { R: R / n, G: G / n, B: B / n, sum: (R + G + B) / n };
  }

  const corners = [
    regionMean(0, 0, 12),
    regionMean(w - 12, 0, 12),
    regionMean(0, h - 12, 12),
    regionMean(w - 12, h - 12, 12),
  ];
  // True empty pad/rotate fill is near-black. Blue content ~ sum 300+. White markers ~765.
  const empty = corners.filter((c) => c.sum < 40).length;

  // Marker distance: red @500, lime @780 → source span 280. Screen dist falls as we zoom OUT.
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
    if (R - (G + B) / 2 > bestR) {
      bestR = R - (G + B) / 2;
      redX = x;
    }
    if (G - (R + B) / 2 > bestL) {
      bestL = G - (R + B) / 2;
      limeX = x;
    }
  }

  function yellowY(x: number) {
    let best = -1e9,
      yy = 0;
    for (let y = 280; y < 440; y++) {
      const i = (y * w + x) * 3;
      const score = buf[i] + buf[i + 1] - 2 * buf[i + 2];
      if (score > best) {
        best = score;
        yy = y;
      }
    }
    return yy;
  }
  const tiltPx = yellowY(Math.floor(w * 0.8)) - yellowY(Math.floor(w * 0.2));

  // White corner markers visible? (zoom out brings them in)
  const tl = regionMean(5, 5, 40);
  const whiteTL = tl.R > 180 && tl.G > 180 && tl.B > 180;

  return {
    t,
    markerDist: limeX - redX,
    tiltPx,
    empty,
    cornerSums: corners.map((c) => Math.round(c.sum)),
    whiteTL,
    redX,
    limeX,
  };
}

function tryParams(A: number, safety: number) {
  const d = 6;
  const endS = 1.0;
  const need = overscan(A) * safety;
  const startS = Math.max(1 / 0.93, (need - endS * (1 - 0.55)) / 0.55);
  console.log("\n=== try A=" + A + " safety=" + safety + " startS=" + startS.toFixed(4) + " ===");

  const outZ = encode("z_" + A, "setpts=PTS/0.45," + buildFilter(startS, endS, 0, d));
  if (!outZ) return false;
  const zE = analyze(outZ, 0.25);
  const zL = analyze(outZ, 5.7);
  const zoomDelta = zL.markerDist - zE.markerDist;
  console.log("zoomOnly", { early: zE.markerDist, late: zL.markerDist, delta: zoomDelta, whiteTL_e: zE.whiteTL, whiteTL_l: zL.whiteTL });

  const out = encode("c_" + A, "setpts=PTS/0.45," + buildFilter(startS, endS, A, d));
  if (!out) return false;
  const times = [0.15, 1.32, 2.4, 3.3, 5.9];
  const rows = times.map((t) => analyze(out, t));
  for (const row of rows) console.log(row);

  const emptyHits = rows.reduce((a, row) => a + row.empty, 0);
  const tilts = rows.map((row) => row.tiltPx);
  // Zoom OUT: marker distance decreases (same source span maps smaller on screen)
  const zoomOut = zoomDelta < -15;
  const rollOk =
    tilts[1] < -12 && Math.abs(tilts[2]) < 12 && tilts[3] > 12 && Math.abs(tilts[4]) < 12;
  const ok = emptyHits === 0 && zoomOut && rollOk;
  console.log("RESULT", { ok, emptyHits, zoomOut, zoomDelta, tilts, startS, A });
  return ok;
}

// Sweep until borders clear
const attempts: [number, number][] = [
  [2.0, 1.08],
  [2.0, 1.12],
  [2.5, 1.12],
  [2.5, 1.18],
  [3.0, 1.2],
];
let passed = false;
let best: [number, number] | null = null;
for (const [A, s] of attempts) {
  if (tryParams(A, s)) {
    passed = true;
    best = [A, s];
    break;
  }
}
console.log("\nFINAL", { passed, best });
process.exit(passed ? 0 : 1);
