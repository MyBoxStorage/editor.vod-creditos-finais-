import {
  buildWastedZoomKeyframes,
  buildZoomFilterExpr,
} from "../src/services/candidateExportService.ts";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname);
const kfs = buildWastedZoomKeyframes(6, 100);
const camera = buildZoomFilterExpr(kfs, 1280, 720);
fs.writeFileSync(path.join(tmp, "camera_filter.txt"), camera);
console.log("wrote filter, len", camera.length);

const r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=1280x720:r=30:d=3",
    "-vf",
    `setpts=PTS/0.45,${camera}`,
    "-frames:v",
    "30",
    "-f",
    "null",
    "-",
  ],
  { encoding: "utf8" }
);
console.log("status", r.status);
const lines = r.stderr.split(/\r?\n/);
for (const l of lines) {
  if (/error|Error|failed|Invalid|expr|Parsed|warning|Warning|crop/i.test(l)) {
    console.log(l);
  }
}
console.log("--- tail ---");
console.log(lines.slice(-15).join("\n"));
