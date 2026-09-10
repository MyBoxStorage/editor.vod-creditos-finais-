const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const tmp = __dirname;
fs.mkdirSync(tmp, { recursive: true });

spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "smptebars=s=1280x720:r=30:d=20",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path.join(tmp, "long.mp4"),
  ],
  { stdio: "ignore" }
);

const Z = 1.25;
const effectDur = 6;
const speed = 0.45;
const sourceSeconds = effectDur * speed;

function xExpr(times) {
  let expr = String(times[times.length - 1][1]);
  for (let i = times.length - 2; i >= 0; i--) {
    const [t0, v0] = times[i];
    const [t1, v1] = times[i + 1];
    const lerp = `${v0}+(${v1}-${v0})*(t-${t0})/${t1 - t0}`;
    expr = `if(lt(t\\,${t0})\\,${v0}\\,if(lt(t\\,${t1})\\,${lerp}\\,${expr}))`;
  }
  return expr;
}

function cropFor(times) {
  const xe = xExpr(times);
  return (
    `crop=w='iw/${Z}':h='ih/${Z}':` +
    `x='iw*(${xe})/100-(iw/${Z})/2':` +
    `y='(ih-ih/${Z})/2'`
  );
}

const effectTimes = [
  [0, 50],
  [1.08, 42],
  [2.04, 50],
  [3.0, 58],
  [3.96, 50],
  [6, 50],
];
const srcTimes = effectTimes.map(([t, x]) => [Number((t * speed).toFixed(4)), x]);

const filters = {
  broken_pts: `setpts=PTS/${speed},${cropFor(effectTimes)},scale=640:360`,
  fixed_pts: `setpts=(PTS-STARTPTS)/${speed},${cropFor(effectTimes)},scale=640:360`,
  camera_before: `${cropFor(srcTimes)},setpts=(PTS-STARTPTS)/${speed},scale=640:360`,
};

for (const [k, vf] of Object.entries(filters)) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "10",
      "-t",
      String(sourceSeconds),
      "-i",
      path.join(tmp, "long.mp4"),
      "-vf",
      vf,
      "-an",
      path.join(tmp, `${k}.mp4`),
    ],
    { encoding: "utf8" }
  );
  console.log(k, r.status === 0 ? "OK" : "FAIL " + r.stderr.slice(-400));
}

function maxRedX(file, t) {
  const png = path.join(tmp, "f.png");
  spawnSync("ffmpeg", ["-y", "-ss", String(t), "-i", file, "-frames:v", "1", png], {
    stdio: "ignore",
  });
  const p = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", png],
    { encoding: "utf8" }
  );
  const [w, h] = p.stdout.trim().split(",").map(Number);
  const r = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: null, maxBuffer: 10e6 }
  );
  const buf = r.stdout;
  const y = Math.floor(h / 2);
  let maxR = -1,
    maxX = 0;
  for (let x = 0; x < w; x++) {
    const v = buf[(y * w + x) * 3];
    if (v > maxR) {
      maxR = v;
      maxX = x;
    }
  }
  return maxX;
}

for (const k of Object.keys(filters)) {
  const atLeft = maxRedX(path.join(tmp, `${k}.mp4`), 1.08);
  const atRight = maxRedX(path.join(tmp, `${k}.mp4`), 3.0);
  const atHold = maxRedX(path.join(tmp, `${k}.mp4`), 5.0);
  console.log(k, { atLeft, atRight, atHold, deltaLR: atRight - atLeft });
}
