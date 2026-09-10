import {
  buildWastedZoomKeyframes,
  buildZoomFilterExpr,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname);

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr_${String(t).replace(".", "_")}.png`);
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

const landmark = path.join(tmp, "landmark.mp4");
if (!fs.existsSync(landmark)) {
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
      "-filter_complex",
      "[0][1]overlay=x=200:y=0",
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
}

function encodeAndMeasure(label: string, camera: string, speed = 0.45) {
  const out = path.join(tmp, `m_${label}.mp4`);
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
    console.log(label, "FAIL", r.stderr.slice(-300));
    return;
  }
  const samples = [1.08, 2.04, 3.0, 5.0].map((t) => [t, findRedCenterX(out, t)] as const);
  const delta = samples[2][1] - samples[0][1];
  console.log(
    label,
    samples.map(([t, x]) => `${t}:${x}`).join(" "),
    "deltaLR",
    delta
  );
}

// A) real wasted keyframes
const wasted = buildWastedZoomKeyframes(6, 100);
encodeAndMeasure("wasted_full", buildZoomFilterExpr(wasted, 1280, 720));

// B) only 2 keyframes pan, constant Z
const two: ZoomKeyframe[] = [
  { time: 0, scale: 1.25, x: 42, y: 50 },
  { time: 6, scale: 1.25, x: 58, y: 50 },
];
encodeAndMeasure("two_kf", buildZoomFilterExpr(two, 1280, 720));

// C) constant everything
const one: ZoomKeyframe[] = [{ time: 0, scale: 1.25, x: 42, y: 50 }];
encodeAndMeasure("one_kf_left", buildZoomFilterExpr(one, 1280, 720));

const oneR: ZoomKeyframe[] = [{ time: 0, scale: 1.25, x: 58, y: 50 }];
encodeAndMeasure("one_kf_right", buildZoomFilterExpr(oneR, 1280, 720));

// D) hand-written simple crop (known working)
const hand =
  "crop=w='iw/1.25':h='ih/1.25':x='iw*(42+16*min(t\\,6)/6)/100-(iw/1.25)/2':y='(ih-ih/1.25)/2',scale=1280:720";
encodeAndMeasure("hand", hand);

console.log("filter two_kf:", buildZoomFilterExpr(two, 1280, 720));
