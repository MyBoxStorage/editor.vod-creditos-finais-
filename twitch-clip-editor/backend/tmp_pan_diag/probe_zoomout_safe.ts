/**
 * Border-safe probe: bright solid bg + landmarks; clamp crop; measure zoom via
 * landmark spacing / position; confirm shake continuous; no true empty borders.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "zoomout_probe2");
fs.mkdirSync(tmp, { recursive: true });

const src = path.join(tmp, "src.mp4");
// Bright blue bg, red vertical at x=200, yellow horizontal at y=200, white corners markers
spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3366AA:s=1280x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=50x720:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x50:r=30:d=8",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=40x40:r=30:d=8",
    "-filter_complex",
    [
      "[0][1]overlay=x=200:y=0[a]",
      "[a][2]overlay=x=0:y=200[b]",
      "[b][3]overlay=x=0:y=0[c]",
      "[c][3]overlay=x=1240:y=0[d]",
      "[d][3]overlay=x=0:y=680[e]",
      "[e][3]overlay=x=1240:y=680",
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
  { stdio: "ignore" }
);

function buildCamera(startZ: number, endZ: number, amp: number, d: number) {
  const zExpr = `${startZ}+(${endZ}-${startZ})*min(t\\,${d})/${d}`;
  // Shake amp scales with available margin: amp * (progress soft)
  // marginFrac ≈ 1-1/z grows as... wait Z decreases so margin shrinks.
  // Keep amp constant but conservative.
  const xExpr = `50+${amp}*sin(2*PI*t/1.8)`;
  const yExpr = `50+${(amp * 0.65).toFixed(3)}*sin(2*PI*t/2.4+0.9)`;
  const cropW = `iw/(${zExpr})`;
  const cropH = `ih/(${zExpr})`;
  // Clamp crop origin so we never sample outside the frame
  return (
    `crop=w='${cropW}':h='${cropH}':` +
    `x='max(0\\,min(iw-(${cropW})\\,iw*(${xExpr})/100-(${cropW})/2))':` +
    `y='max(0\\,min(ih-(${cropH})\\,ih*(${yExpr})/100-(${cropH})/2))',` +
    `scale=1280:720`
  );
}

function encode(label: string, vf: string) {
  const out = path.join(tmp, `${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", src, "-t", "6", "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", r.stderr.slice(-300));
    return null;
  }
  return out;
}

function analyze(file: string, t: number) {
  const png = path.join(tmp, `a_${t}.png`);
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
  function meanCorner(x0: number, y0: number, s = 8) {
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
    meanCorner(0, 0),
    meanCorner(w - 8, 0),
    meanCorner(0, h - 8),
    meanCorner(w - 8, h - 8),
  ];
  // Empty border = near-black (pad) — blue bg is ~51,102,170 sum~323
  const empty = corners.filter((c) => c.sum < 40).length;

  // red X
  let best = -1,
    redX = 0;
  const y = Math.floor(h / 2);
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const score = buf[i] - (buf[i + 1] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      redX = x;
    }
  }
  // yellow Y
  best = -1;
  let yelY = 0;
  const x = Math.floor(w / 2);
  for (let yy = 0; yy < h; yy++) {
    const i = (yy * w + x) * 3;
    const score = buf[i] + buf[i + 1] - buf[i + 2];
    if (score > best) {
      best = score;
      yelY = yy;
    }
  }
  // white TL marker presence (if zoomed out past it without crop, or if visible)
  const tl = meanCorner(0, 0, 12);
  return {
    t,
    redX,
    yelY,
    emptyCorners: empty,
    cornerSums: corners.map((c) => Math.round(c.sum)),
    tlSum: Math.round(tl.sum),
  };
}

// Calibrated: endDisplay 0.93 → endZ≈1.075, startZ≈1.16, amp 2.5
const d = 6;
const cam = buildCamera(1.16, 1.075, 2.5, d);
const out = encode("mono", `setpts=PTS/0.45,${cam}`);
if (!out) process.exit(1);

const times = [0.15, 0.8, 1.6, 2.4, 3.2, 4.0, 5.0, 5.8];
const rows = times.map((t) => analyze(out, t));
console.log("=== monotonic Z + sin shake ===");
for (const r of rows) console.log(r);

const reds = rows.map((r) => r.redX);
const yels = rows.map((r) => r.yelY);
const redRange = Math.max(...reds) - Math.min(...reds);
const yelRange = Math.max(...yels) - Math.min(...yels);
const empties = rows.reduce((a, r) => a + r.emptyCorners, 0);

// Zoom-out check: with amp=0, red should move toward source position (200) as Z→1
const camNoShake = buildCamera(1.16, 1.075, 0, d);
const out2 = encode("noshake", `setpts=PTS/0.45,${camNoShake}`)!;
const early = analyze(out2, 0.2);
const late = analyze(out2, 5.5);
console.log("\n=== zoom only (amp=0) ===");
console.log("early", early);
console.log("late", late);
console.log("\nSUMMARY", {
  redRange,
  yelRange,
  totalEmptyCornerHits: empties,
  zoomOnlyRedDelta: late.redX - early.redX,
  // At Z=1.16 center: red@200 → out = (200 - (1280-1280/1.16)/2) * 1.16
  // At Z=1.075: closer to 200
});

if (empties > 0) {
  console.error("FAIL: empty borders detected");
  process.exit(1);
}
if (redRange < 15 || yelRange < 10) {
  console.error("FAIL: shake not continuous enough", { redRange, yelRange });
  process.exit(1);
}
console.log("PASS");
