/**
 * Measure overlay visibility in export frames (lime PNG in known region).
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { exportCandidate } from "../src/services/candidateExportService.js";

initDb();

const CANDIDATE_ID = "3c8e4c22-5448-4011-b9d3-04bed71c6fcf";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// overlay box % — matches apply payload
const OX = 0.1;
const OY = 0.15;
const OW = 0.37;
const OH = 0.18;

function sampleFrame(
  videoPath: string,
  t: number,
  outPng: string
): { gMean: number; rMean: number; blackPct: number } | null {
  spawnSync(
    "ffmpeg",
    ["-y", "-ss", String(t), "-i", videoPath, "-frames:v", "1", outPng],
    { stdio: "ignore" }
  );
  if (!fs.existsSync(outPng)) return null;

  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      outPng,
    ],
    { encoding: "utf8" }
  );
  let w = 1080;
  let h = 1920;
  try {
    const j = JSON.parse(probe.stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
    };
    w = j.streams?.[0]?.width ?? w;
    h = j.streams?.[0]?.height ?? h;
  } catch {
    /* keep defaults */
  }

  const cx = Math.round(w * (OX + OW / 2));
  const cy = Math.round(h * (OY + OH / 2));
  const cropW = Math.max(8, Math.round(w * OW * 0.4));
  const cropH = Math.max(8, Math.round(h * OH * 0.4));
  const cropX = Math.max(0, cx - Math.floor(cropW / 2));
  const cropY = Math.max(0, cy - Math.floor(cropH / 2));

  const raw = spawnSync(
    "ffmpeg",
    [
      "-i",
      outPng,
      "-vf",
      `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=1:1`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 }
  );
  const buf = raw.stdout as Buffer;
  if (!buf?.length) return null;

  let rSum = 0;
  let gSum = 0;
  let black = 0;
  const px = buf.length / 3;
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    rSum += r;
    gSum += g;
    if (r < 8 && g < 8 && b < 8) black++;
  }
  return {
    rMean: rSum / px,
    gMean: gSum / px,
    blackPct: (black / px) * 100,
  };
}

function relOpacity(g: number, base: number, full: number): number {
  if (full <= base + 0.5) return 0;
  return Math.max(0, Math.min(1, (g - base) / (full - base)));
}

const t0 = Date.now();
const result = await exportCandidate(CANDIDATE_ID, {
  useSubtitles: false,
  subtitleRange: null,
  quality: "hd",
  speed: 1,
  preset: "vertical-split-9x16",
});
const exportMs = Date.now() - t0;
const exportPath = result.prontosPath;
if (!exportPath || !fs.existsSync(exportPath)) {
  console.error("export missing");
  process.exit(1);
}

const times = [2.8, 3.0, 3.2, 4.0, 4.8, 5.0, 5.4];
const samples: Record<string, unknown> = {};
for (const t of times) {
  const png = path.join(scriptDir, `val-export-${t}.png`);
  samples[String(t)] = sampleFrame(exportPath, t, png);
}

const base = (samples["2.8"] as { gMean: number } | null)?.gMean ?? 0;
const full = (samples["4.0"] as { gMean: number } | null)?.gMean ?? 1;

const compareTimes = [3.2, 4.0, 4.8];
const expected: Record<string, number> = { "3.2": 0.5, "4.0": 1.0, "4.8": 0.5 };

console.log(
  JSON.stringify(
    {
      exportPath,
      exportMs,
      baselineG2_8: base,
      fullG4_0: full,
      frames: samples,
      opacityEstimate: Object.fromEntries(
        compareTimes.map((t) => {
          const s = samples[String(t)] as { gMean: number } | null;
          return [
            String(t),
            {
              expected: expected[String(t)],
              measured: s ? relOpacity(s.gMean, base, full) : null,
            },
          ];
        })
      ),
    },
    null,
    2
  )
);
