import { spawnSync } from "child_process";
import path from "path";

const tmp = path.join(__dirname);
const landmark = path.join(tmp, "landmark.mp4");

function findRedCenterX(file: string, t: number): number {
  const png = path.join(tmp, `fr4_${String(t).replace(".", "_")}.png`);
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
  const out = path.join(tmp, `h_${label}.mp4`);
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-ss", "5", "-t", "2.7", "-i", landmark, "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  console.log(label, r.status === 0 ? "OK" : "FAIL");
  if (r.status === 0) {
    console.log(
      " ",
      [0.2, 1.0, 2.0].map((t) => `${t}:${findRedCenterX(out, t)}`).join(" ")
    );
  } else {
    console.log(r.stderr.slice(-300));
  }
}

// Hand animated Z with simple expr, x pans 42→58
run(
  "hand_animZ",
  "setpts=PTS/0.45," +
    "crop=w='iw/(1.25)':h='ih/(1.25)':" +
    "x='iw*(42+16*min(t\\,6)/6)/100-(iw/1.25)/2':y='(ih-ih/1.25)/2'," +
    "scale=1280:720"
);

// Animated Z simple
run(
  "hand_zoom_in",
  "setpts=PTS/0.45," +
    "crop=w='iw/(1+0.25*min(t\\,1))':h='ih/(1+0.25*min(t\\,1))':" +
    "x='(iw-ow)/2':y='(ih-oh)/2'," +
    "scale=1280:720"
);

// scale filter for zoom instead of crop size change: scale up then crop fixed
run(
  "scale_then_crop",
  "setpts=PTS/0.45," +
    "scale=iw*1.25:ih*1.25," +
    "crop=1280:720:x='(in_w-1280)*(42+16*min(t\\,6)/6)/100':y='(in_h-720)/2'"
);
