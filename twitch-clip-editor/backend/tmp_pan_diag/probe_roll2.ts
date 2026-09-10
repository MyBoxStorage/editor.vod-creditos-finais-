import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "roll_probe2");
fs.mkdirSync(tmp, { recursive: true });

const src = path.join(tmp, "grid.mp4");
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

function angleExpr(d: number, A: number) {
  const p1 = d * 0.25;
  const p2 = d * 0.5;
  const p3 = d * 0.75;
  return (
    `if(lt(t\\,${p1})\\,${-A}*t/${p1}\\,` +
    `if(lt(t\\,${p2})\\,${-A}+${A}*(t-${p1})/${p2 - p1}\\,` +
    `if(lt(t\\,${p3})\\,${A}*(t-${p2})/${p3 - p2}\\,` +
    `${A}-${A}*(t-${p3})/${d - p3})))`
  );
}

/** Scale-up → rotate in-place → center crop. S must cover overscan(A). */
function buildFilter(startS: number, endS: number, A: number, d: number, outW = 1280, outH = 720) {
  const sExpr = `${startS}+(${endS}-${startS})*min(t\\,${d})/${d}`;
  const aExpr = angleExpr(d, A);
  return [
    `scale=w='max(2\\,trunc(iw*(${sExpr})/2)*2)':h='max(2\\,trunc(ih*(${sExpr})/2)*2)':eval=frame`,
    `rotate=a='(${aExpr})*PI/180':ow=iw:oh=ih:c=black`,
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
    console.log(label, "FAIL\n", r.stderr.slice(-600));
    return null;
  }
  console.log(label, "OK");
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
  const tiltPx = yellowY(Math.floor(w * 0.8)) - yellowY(Math.floor(w * 0.2));
  return {
    t,
    markerDist: limeX - redX,
    tiltPx,
    empty,
    corners: corners.map((c) => Math.round(c)),
  };
}

const d = 6;
const A = 2.5;
const endS = 1.0;
const need = overscan(A) * 1.04;
const startSMin = (need - endS * 0.75) / 0.25;
const startS = Math.max(1 / 0.93, startSMin);
console.log({ A, need, startS, endS, overscan: overscan(A) });

// Try a few variants if first fails
const variants: [string, string][] = [
  ["v1", `setpts=PTS/0.45,${buildFilter(startS, endS, A, d)}`],
];

for (const [name, vf] of variants) {
  const out = encode(name, vf);
  if (!out) continue;
  const times = [0.2, 1.5, 3.0, 4.5, 5.8];
  const rows = times.map((t) => analyze(out, t));
  for (const r of rows) console.log(name, r);

  const outZ = encode(name + "_z", `setpts=PTS/0.45,${buildFilter(startS, endS, 0, d)}`);
  const early = analyze(outZ!, 0.25);
  const late = analyze(outZ!, 5.7);
  console.log("zoomOnly early/late", early.markerDist, late.markerDist, "delta", late.markerDist - early.markerDist);

  const emptyHits = rows.reduce((a, r) => a + r.empty, 0);
  const tilts = rows.map((r) => r.tiltPx);
  console.log("summary", {
    emptyHits,
    tilts,
    zoomOut: late.markerDist < early.markerDist - 15,
    left: tilts.some((x) => x < -6),
    right: tilts.some((x) => x > 6),
  });
}
