import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr6_${String(t).replace(".", "_")}.png`);
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

function run(label: string, vf: string) {
  const out = path.join(tmp, `g_${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-ss", "5", "-t", "2.7", "-i", landmark, "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log(label, "FAIL", r.stderr.slice(-400));
    return;
  }
  console.log(
    label,
    [1.08, 3.0].map((t) => `${t}:${findRedCenterX(out, t)}`).join(" ")
  );
}

const speed = 0.45;
const setpts = `setpts=PTS/${speed}`;

// A) old crop style constant Z — known working
run(
  "old_crop_pan",
  `${setpts},crop=w='iw/1.25':h='ih/1.25':x='iw*(42+16*min(t\\,6)/6)/100-(iw/1.25)/2':y='(ih-ih/1.25)/2',scale=1280:720`
);

// B) scale then crop with animated x, constant Z
run(
  "stc_constZ",
  `${setpts},scale=iw*1.25:ih*1.25,crop=1280:720:x='iw*(42+16*min(t\\,6)/6)/100-640':y='(ih-720)/2'`
);

// C) scale eval=frame with z expr constant 1.25, x animates
run(
  "stc_eval",
  `${setpts},scale=w='iw*1.25':h='ih*1.25':eval=frame,crop=1280:720:x='iw*(42+16*min(t\\,6)/6)/100-640':y='(ih-720)/2'`
);

// D) ONLY left vs ONLY right static stc
run(
  "stc_left",
  `${setpts},scale=iw*1.25:ih*1.25,crop=1280:720:x='iw*0.42-640':y='(ih-720)/2'`
);
run(
  "stc_right",
  `${setpts},scale=iw*1.25:ih*1.25,crop=1280:720:x='iw*0.58-640':y='(ih-720)/2'`
);
