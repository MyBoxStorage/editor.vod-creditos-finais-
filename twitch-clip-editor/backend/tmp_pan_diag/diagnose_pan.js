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
    "smptebars=s=1280x720:r=30:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path.join(tmp, "bars.mp4"),
  ],
  { stdio: "ignore" }
);

const Z = 1.4;

function cropExpr(dur) {
  // Extreme pan: xPct = 20 + 60*(t/dur) → 20→80
  return (
    `crop=w='iw/${Z}':h='ih/${Z}':` +
    `x='iw*(20+60*min(t\\,${dur})/${dur})/100-(iw/${Z})/2':` +
    `y='(ih-ih/${Z})/2'`
  );
}

const filters = {
  after: `setpts=PTS/0.5,${cropExpr(4)},scale=640:360`,
  before: `${cropExpr(2)},setpts=PTS/0.5,scale=640:360`,
  noset: `${cropExpr(2)},scale=640:360`,
};

for (const [k, vf] of Object.entries(filters)) {
  const dur = k === "noset" ? "2" : "4";
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", path.join(tmp, "bars.mp4"), "-t", dur, "-vf", vf, "-an", path.join(tmp, `${k}.mp4`)],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.log("FAIL", k, r.stderr.slice(-500));
  } else {
    console.log("OK", k);
  }
}

function rawAt(file, t) {
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
  return { w, h, buf: r.stdout };
}

function leftRight(file, t) {
  const { w, h, buf } = rawAt(file, t);
  function meanR(x0, x1) {
    let s = 0,
      n = 0;
    for (let y = Math.floor(h * 0.4); y < h * 0.6; y++) {
      for (let x = x0; x < x1; x++) {
        s += buf[(y * w + x) * 3];
        n++;
      }
    }
    return s / n;
  }
  const L = meanR(0, Math.floor(w * 0.12));
  const R = meanR(Math.floor(w * 0.88), w);
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
  return { L: L.toFixed(0), R: R.toFixed(0), maxRedX: maxX };
}

for (const k of ["after", "before", "noset"]) {
  const late = k === "noset" ? 1.8 : 3.6;
  console.log(
    k,
    "t=0.2",
    leftRight(path.join(tmp, `${k}.mp4`), 0.2),
    "t=" + late,
    leftRight(path.join(tmp, `${k}.mp4`), late)
  );
}
