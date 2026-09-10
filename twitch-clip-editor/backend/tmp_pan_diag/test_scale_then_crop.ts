import {
  buildZoomFilterExpr,
  buildWastedZoomKeyframes,
  type ZoomKeyframe,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr5_${String(t).replace(".", "_")}.png`);
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

function measure(label: string, camera: string) {
  const out = path.join(tmp, `fix_${label}.mp4`);
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
    console.log(label, "FAIL", r.stderr.slice(-350));
    return;
  }
  const L = findRedCenterX(out, 1.08);
  const R = findRedCenterX(out, 3.0);
  const early = findRedCenterX(out, 0.15);
  console.log(label, `early=${early} L=${L} R=${R} dLR=${R - L}`);
}

function lerpProp(pts: ZoomKeyframe[], prop: "scale" | "x" | "y"): string {
  if (pts.length === 1) return String(Number(pts[0][prop].toFixed(6)));
  let expr = String(Number(pts[pts.length - 1][prop].toFixed(6)));
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const b = pts[i + 1];
    const t0 = Number(a.time.toFixed(6));
    const t1 = Number(b.time.toFixed(6));
    const v0 = Number(a[prop].toFixed(6));
    const v1 = Number(b[prop].toFixed(6));
    const dt = t1 - t0;
    const lerp =
      dt === 0 ? String(v0) : `${v0}+(${v1}-${v0})*(t-${t0})/${Number(dt.toFixed(6))}`;
    expr = `if(lt(t\\,${t0})\\,${v0}\\,if(lt(t\\,${t1})\\,${lerp}\\,${expr}))`;
  }
  return expr;
}

function scaleThenCrop(kfs: ZoomKeyframe[], outW: number, outH: number): string {
  const pts = [...kfs].sort((a, b) => a.time - b.time);
  const zExpr = lerpProp(pts, "scale");
  const xExpr = lerpProp(pts, "x");
  const yExpr = lerpProp(pts, "y");
  // eval=frame required for time-varying scale; fixed crop size avoids broken crop w/h
  return (
    `scale=w='max(2\\,trunc(iw*(${zExpr})/2)*2)':h='max(2\\,trunc(ih*(${zExpr})/2)*2)':eval=frame,` +
    `crop=${outW}:${outH}:` +
    `x='max(0\\,min(iw-${outW}\\,iw*(${xExpr})/100-${outW}/2))':` +
    `y='max(0\\,min(ih-${outH}\\,ih*(${yExpr})/100-${outH}/2))'`
  );
}

const wasted = buildWastedZoomKeyframes(6, 100);
measure("old_wasted", buildZoomFilterExpr(wasted, 1280, 720));
measure("new_wasted", scaleThenCrop(wasted, 1280, 720));

const peaksAnim: ZoomKeyframe[] = [
  { time: 0, scale: 1, x: 50, y: 50 },
  { time: 0.3, scale: 1.25, x: 50, y: 50 },
  { time: 1.08, scale: 1.25, x: 42, y: 50 },
  { time: 2.04, scale: 1.25, x: 50, y: 50 },
  { time: 3.0, scale: 1.25, x: 58, y: 50 },
  { time: 3.96, scale: 1.25, x: 50, y: 50 },
  { time: 6, scale: 1, x: 50, y: 50 },
];
measure("new_peaks_anim", scaleThenCrop(peaksAnim, 1280, 720));
