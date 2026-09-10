import { spawnSync } from "child_process";
import fs from "fs";

const base =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/data/v2820282061/prontos/run_2026-07-22_15h03_semantic/3c8e4c22-5448-4011-b9d3-04bed71c6fcf_final.mp4";
const wasted =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/data/_library/video/57922468-5e30-4008-bf10-c658c84ec096.mp4";
const out =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/scripts/_test-video-only.mp4";
const png =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/scripts/_test-video-only-7.5.png";

const filter =
  "[1:v]trim=start=0:end=2,setpts=PTS-STARTPTS,tpad=start_duration=7:start_mode=add,scale=378:480,format=yuva420p,chromakey=0x00FF00:0.2:0.1[ov];[0:v][ov]overlay=x=594:y=1152:enable='between(t\\,7\\,9)':format=auto[v]";

const r = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "5",
    "-t",
    "6",
    "-i",
    base,
    "-i",
    wasted,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    out,
  ],
  { encoding: "utf8" }
);
console.log("ffmpeg", r.status);

spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    "2.5",
    "-i",
    out,
    "-vf",
    "crop=378:480:594:1152",
    "-update",
    "1",
    "-frames:v",
    "1",
    png,
  ],
  { stdio: "ignore" }
);
console.log("png exists", fs.existsSync(png));
