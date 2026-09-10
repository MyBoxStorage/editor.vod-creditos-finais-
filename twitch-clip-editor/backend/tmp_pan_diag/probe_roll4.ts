import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const tmp = path.join(__dirname, "roll_probe4");
fs.mkdirSync(tmp, { recursive: true });
const W = 1280;
const H = 720;
const src = path.join(tmp, "stripes.mp4");

const mk = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${W}x${H}:rate=30:duration=8`,
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=1280x10:r=30:d=8",
    "-filter_complex",
    "[0]scale=1280:720,setsar=1[v];[v][1]overlay=x=0:y=355",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    src,
  ],
  { encoding: "utf8" }
);
if (mk.status !== 0) {
  console.log("src FAIL", mk.stderr.slice(-400));
  process.exit(1);
}
console.log("src OK", fs.statSync(src).size);

function overscan(deg: number) {
  const rad = (Math.abs(deg) * Math.PI) / 180;
  return Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
}

function angleExpr(d: number, A: number) {
  const t1 = d * 0.22;
  const t2 = d * 0.4;
  const t3 = d * 0.55;
  return (
    "if(lt(t\\," +
    t1 +
    ")\\," +
    -A +
    "*t/" +
    t1 +
    "\\," +
    "if(lt(t\\," +
    t2 +
    ")\\," +
    -A +
    "+" +
    A +
    "*(t-" +
    t1 +
    ")/" +
    (t2 - t1) +
    "\\," +
    "if(lt(t\\," +
    t3 +
    ")\\," +
    A +
    "*(t-" +
    t2 +
    ")/" +
    (t3 - t2) +
    "\\," +
    A +
    "*(1-(t-" +
    t3 +
    ")/" +
    (d - t3) +
    "))))"
  );
}

function buildFilter(startS: number, endS: number, A: number, d: number) {
  const s0 = Number(startS.toFixed(4));
  const s1 = Number(endS.toFixed(4));
  const sExpr = s0 + "+(" + s1 + "-" + s0 + ")*min(t\\," + d + ")/" + d;
  const aExpr = angleExpr(d, A);
  return [
    "scale=w='max(2\\,trunc(iw*(" + sExpr + ")/2)*2)':h='max(2\\,trunc(ih*(" + sExpr + ")/2)*2)':eval=frame",
    "rotate=a='(" + aExpr + ")*PI/180':ow=iw:oh=ih:c=black",
    "crop=" + W + ":" + H + ":(iw-" + W + ")/2:(ih-" + H + ")/2",
  ].join(",");
}

function encode(label: string, vf: string) {
  const out = path.join(tmp, label + ".mp4");
  const er = spawnSync(
    "ffmpeg",
    ["-y", "-i", src, "-t", "6", "-vf", vf, "-an", out],
    { encoding: "utf8" }
  );
  if (er.status !== 0) {
    console.log(label, "FAIL", er.stderr.slice(-400));
    return null;
  }
  return out;
}

function analyze(file: string, t: number) {
  const png = path.join(tmp, "f_" + String(t).replace(".", "_") + ".png");
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
  const parts = p.stdout.trim().split(",");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  const raw = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { encoding: null, maxBuffer: 20e6 }
  );
  const buf = raw.stdout as Buffer;

  function cornerSum(x0: number, y0: number) {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = x0; x < x0 + 8; x++) {
        const i = (y * w + x) * 3;
        s += buf[i] + buf[i + 1] + buf[i + 2];
        n++;
      }
    }
    return s / n;
  }
  const corners = [
    cornerSum(0, 0),
    cornerSum(w - 8, 0),
    cornerSum(0, h - 8),
    cornerSum(w - 8, h - 8),
  ];
  const empty = corners.filter((c) => c < 20).length;

  const y0 = Math.floor(h * 0.55);
  const y1 = Math.floor(h * 0.7);
  let edge = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 3;
      const j = (y * w + (x - 1)) * 3;
      const dlt =
        Math.abs(buf[i] - buf[j]) +
        Math.abs(buf[i + 1] - buf[j + 1]) +
        Math.abs(buf[i + 2] - buf[j + 2]);
      if (dlt > 40) edge++;
      n++;
    }
  }
  const edgeDensity = edge / n;

  function yellowY(x: number) {
    let best = -1e9;
    let yy = 0;
    for (let y = 300; y < 420; y++) {
      const i = (y * w + x) * 3;
      const score = buf[i] + buf[i + 1] - 2 * buf[i + 2];
      if (score > best) {
        best = score;
        yy = y;
      }
    }
    return yy;
  }
  const tiltPx = yellowY(Math.floor(w * 0.85)) - yellowY(Math.floor(w * 0.15));

  return {
    t,
    edgeDensity: Number(edgeDensity.toFixed(4)),
    tiltPx,
    empty,
    corners: corners.map((c) => Math.round(c)),
  };
}

const d = 6;
const A = 2.5;
const endS = 1.0;
const need = overscan(A) * 1.03;
const startS = Math.max(1 / 0.93, (need - endS * (1 - 0.55)) / 0.55);
console.log({ A, startS: Number(startS.toFixed(4)), endS });

const outZ = encode("z", "setpts=PTS/0.45," + buildFilter(startS, endS, 0, d));
const zE = analyze(outZ as string, 0.25);
const zL = analyze(outZ as string, 5.7);
console.log("zoom only early", zE);
console.log("zoom only late ", zL);
const dEdge = zL.edgeDensity - zE.edgeDensity;
console.log("dEdgeDensity (OUT => +):", dEdge);

const out = encode("cam", "setpts=PTS/0.45," + buildFilter(startS, endS, A, d));
const times = [0.15, 1.32, 2.4, 3.3, 5.9];
const rows = times.map((t) => analyze(out as string, t));
console.log("roll+zoom:");
for (const row of rows) console.log(row);

const emptyHits = rows.reduce((a, row) => a + row.empty, 0);
const tilts = rows.map((row) => row.tiltPx);
const zoomOut = dEdge > 0.005;
const rollOk =
  tilts[1] < -10 && Math.abs(tilts[2]) < 12 && tilts[3] > 10 && Math.abs(tilts[4]) < 12;
const ok = emptyHits === 0 && zoomOut && rollOk;
console.log("PASS?", ok, { emptyHits, zoomOut, dEdge, tilts });
process.exit(ok ? 0 : 1);
