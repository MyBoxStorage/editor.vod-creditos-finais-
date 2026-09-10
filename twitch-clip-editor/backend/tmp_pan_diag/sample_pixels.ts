import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname, "wasted_roll_evidence");

function sample(file: string, t: number) {
  const png = path.join(tmp, "s.png");
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
  function at(x: number, y: number) {
    const i = (y * w + x) * 3;
    return [buf[i], buf[i + 1], buf[i + 2]];
  }
  return {
    w,
    h,
    tl: at(2, 2),
    tr: at(w - 3, 2),
    mid: at((w / 2) | 0, (h / 2) | 0),
    ml: at((w * 0.35) | 0, (h * 0.5) | 0),
  };
}

console.log("base", sample(path.join(tmp, "real_base.mp4"), 0.5));
for (const t of [0.2, 1.3, 3.3, 5.8]) {
  console.log("cam" + t, sample(path.join(tmp, "real_cam.mp4"), t));
}
