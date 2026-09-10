/** Finish validation report from existing exports. */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c3_contiguous");
const RUN = path.join(
  __dirname,
  "..",
  "data",
  "v2820282061",
  "prontos",
  "run_2026-07-22_15h03_semantic"
);
const PRESET = "vertical-split-9x16";

async function audioRmsAt(file: string, timeSec: number): Promise<number> {
  const start = Math.max(0, timeSec - 0.02);
  return new Promise((resolve) => {
    let err = "";
    spawn(
      "ffmpeg",
      ["-ss", String(start), "-t", "0.04", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
      { windowsHide: true, shell: process.platform === "win32" }
    )
      .stderr!.on("data", (c: Buffer) => (err += c.toString()))
      .on("close", () => {
        const m = err.match(/mean_volume:\s*([-\d.]+)/);
        resolve(m ? parseFloat(m[1]) : -91);
      });
  });
}

async function joinRms(file: string, t: number) {
  const beforeDb = await audioRmsAt(file, t - 0.03);
  const afterDb = await audioRmsAt(file, t + 0.03);
  return {
    beforeDb,
    afterDb,
    deltaDb: Math.abs(beforeDb - afterDb),
    jumpDb: Math.abs(beforeDb - afterDb),
  };
}

async function extractFrame(mp4: string, time: number, png: string) {
  await fs.mkdir(path.dirname(png), { recursive: true });
  return new Promise<void>((res, rej) => {
    spawn(
      "ffmpeg",
      ["-y", "-ss", String(time), "-i", mp4, "-frames:v", "1", png],
      { windowsHide: true, shell: process.platform === "win32" }
    ).on("close", (c) => (c === 0 ? res() : rej(new Error("frame"))));
  });
}

function buildSegments(comp: ReturnType<typeof getCompositionWithSegments>) {
  return comp.segments
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => ({ clipSegmentId: s.clipSegment.id }));
}

async function main() {
  const meta = JSON.parse(
    await fs.readFile(path.join(OUT, "composition.json"), "utf8")
  );
  const times = [5, 10, 15];
  const files: Record<string, string> = {
    default_cross: path.join(RUN, "val_default_cross.mp4"),
    all_hard: path.join(RUN, "val_all_hard.mp4"),
    j1_l2: path.join(RUN, "val_j1_l2.mp4"),
    ov01_j2: path.join(RUN, "val_ov0.1_j2.mp4"),
    ov02_j2: path.join(RUN, "val_ov0.2_j2.mp4"),
    ov05_j2: path.join(RUN, "val_ov0.5_j2.mp4"),
    subtitles: path.join(RUN, "val_subtitles.mp4"),
  };

  const rms: Record<string, unknown> = {};
  for (const [label, file] of Object.entries(files)) {
    if (label.startsWith("ov")) {
      rms[label] = await joinRms(file, 10);
      continue;
    }
    const rows = [];
    for (let i = 0; i < times.length; i++) {
      rows.push({ join: i + 1, time: times[i], ...(await joinRms(file, times[i])) });
    }
    rms[label] = rows;
  }

  const subFile = files.subtitles;
  for (const t of [1, 6, 11, 16]) {
    await extractFrame(subFile, t, path.join(OUT, "frames", `subtitle_t${t}.png`));
  }
  await extractFrame(subFile, 10.5, path.join(OUT, "frames", "subtitle_gap_10.5.png"));

  const comp = getCompositionWithSegments(meta.compositionId);
  const segments = buildSegments(comp);
  const wastedApp = expandEmotionPreset({
    presetId: "wasted",
    effectStart: 0.5,
    effectEnd: 4.5,
    effectDuration: 4,
    clipDuration: 5,
    intensityPercent: 100,
  });
  const wastedPayload = {
    presetId: "wasted",
    effectStart: 0.5,
    effectEnd: 4.5,
    effectDuration: 4,
    intensityPercent: 100,
    colorPreset: wastedApp.colorPreset,
    colorEffectStart: 0.5,
    colorEffectEnd: 4.5,
  };
  const color = await exportUnifiedComposition({
    vodId: meta.vodId,
    quality: "hd",
    preset: PRESET,
    segments: segments.map((s, i) => ({
      ...s,
      presetApplications: i === 1 ? [wastedPayload] : undefined,
    })),
    outputName: "val_color_wasted.mp4",
    colorSettings: { enabled: true, preset: "vivid", intensityPercent: 100 },
  });
  const colorFrame = path.join(OUT, "frames", "color_wasted_seg2.png");
  await extractFrame(color.prontosPath, 7, colorFrame);

  const report = {
    compositionId: meta.compositionId,
    joinTimes: times,
    effectiveOverlapAllJoins: 0.2,
    rms,
    subtitleFrames: [1, 6, 11, 16, "gap@10.5"],
    colorConflictPath: color.prontosRelativePath,
    colorFrame,
  };
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error);
