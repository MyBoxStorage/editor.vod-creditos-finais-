import {
  buildZoomFilterExpr,
  buildWastedZoomKeyframes,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");
const z = 1.25;

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr3_${String(t).replace(".", "_")}.png`);
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
    const score = buf[i] - (buf[i + 1] + buf[i + 2]) / 2;
    if (score > best) {
      best = score;
      bestX = x;
    }
  }
  return bestX;
}

function encodeAndMeasure(label: string, kfs: ZoomKeyframe[]) {
  const camera = buildZoomFilterExpr(kfs, 1280, 720);
  const out = path.join(tmp, `s_${label}.mp4`);
  const speed = 0.45;
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "5",
      "-t",
      String(6 * speed),
      "-i",
      landmark,
      "-vf",
      `setpts=PTS/${speed},${camera}`,
      "-an",
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", r.stderr.slice(-250));
    return;
  }
  const pts = [0.2, 1.08, 2.04, 3.0, 5.0];
  const xs = pts.map((t) => findRedCenterX(out, t));
  console.log(
    label,
    "flen",
    camera.length,
    pts.map((t, i) => `${t}:${xs[i]}`).join(" "),
    "dLR",
    xs[3] - xs[1]
  );
}

// peaks with animated scale (broken before)
encodeAndMeasure("peaks_animZ", [
  { time: 0, scale: 1, x: 50, y: 50 },
  { time: 0.3, scale: z, x: 50, y: 50 },
  { time: 1.08, scale: z, x: 42, y: 50 },
  { time: 2.04, scale: z, x: 50, y: 50 },
  { time: 3.0, scale: z, x: 58, y: 50 },
  { time: 3.96, scale: z, x: 50, y: 50 },
  { time: 5.75, scale: z, x: 50, y: 50 },
  { time: 6, scale: 1, x: 50, y: 50 },
]);

// same peaks, constant Z
encodeAndMeasure(
  "peaks_flatZ",
  [
    { time: 0, scale: z, x: 50, y: 50 },
    { time: 1.08, scale: z, x: 42, y: 50 },
    { time: 2.04, scale: z, x: 50, y: 50 },
    { time: 3.0, scale: z, x: 58, y: 50 },
    { time: 3.96, scale: z, x: 50, y: 50 },
    { time: 6, scale: z, x: 50, y: 50 },
  ]
);

// real wasted
encodeAndMeasure("wasted", buildWastedZoomKeyframes(6, 100));

// wasted but force all scales to z (no 1.0 endpoints)
encodeAndMeasure(
  "wasted_noz1",
  buildWastedZoomKeyframes(6, 100).map((k) => ({ ...k, scale: z }))
);

// only scale animates, x fixed 42
encodeAndMeasure("scale_only", [
  { time: 0, scale: 1, x: 42, y: 50 },
  { time: 0.3, scale: z, x: 42, y: 50 },
  { time: 5.75, scale: z, x: 42, y: 50 },
  { time: 6, scale: 1, x: 42, y: 50 },
]);
