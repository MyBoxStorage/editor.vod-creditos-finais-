/**
 * C3 validation — audio joins, subtitles, color grade on e2e-real-composition.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import {
  compositionPreviewRenderWindow,
} from "../src/services/compositionPreviewRenderService.js";
import {
  DEFAULT_COMPOSITION_JOIN_SETTINGS,
  type CompositionJoinSettings,
} from "../src/services/compositionJoinSettings.js";
import {
  parseCompositionColorSettings,
  type CompositionColorSettings,
} from "../src/services/compositionColorSettings.js";
import { parseCompositionJoinSettings } from "../src/services/compositionJoinSettings.js";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c3");
const COMP_ID = "ca94471d-ab2e-444e-96ff-1bd2ed1837bf";
const PRESET = "vertical-split-9x16";

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
    );
  });
}

/** RMS in dB for a short audio slice — lower discontinuity = smoother join. */
async function audioRmsAt(
  file: string,
  timeSec: number,
  windowSec = 0.05
): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Math.max(0, timeSec - windowSec / 2);
    const child = spawn(
      "ffmpeg",
      [
        "-ss",
        String(start),
        "-t",
        String(windowSec),
        "-i",
        file,
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.slice(-300)));
        return;
      }
      const m = err.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      resolve(m ? parseFloat(m[1]) : -100);
    });
  });
}

async function joinDiscontinuity(
  file: string,
  joinTime: number
): Promise<{ beforeDb: number; afterDb: number; deltaDb: number }> {
  const beforeDb = await audioRmsAt(file, joinTime - 0.02);
  const afterDb = await audioRmsAt(file, joinTime + 0.02);
  return { beforeDb, afterDb, deltaDb: Math.abs(beforeDb - afterDb) };
}

function buildSegments(comp: ReturnType<typeof getCompositionWithSegments>) {
  return comp.segments
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => ({
      clipSegmentId: s.clipSegment.id,
      presetApplications: Array.isArray(s.clipSegment.presetApplicationsJson)
        ? s.clipSegment.presetApplicationsJson
        : undefined,
    }));
}

function joinTimesFromDurations(durs: number[]): number[] {
  const times: number[] = [];
  let acc = 0;
  for (let i = 0; i < durs.length - 1; i++) {
    acc += durs[i];
    times.push(Number(acc.toFixed(3)));
  }
  return times;
}

async function exportCase(
  vodId: string,
  segments: ReturnType<typeof buildSegments>,
  label: string,
  joinSettings?: CompositionJoinSettings,
  colorSettings?: CompositionColorSettings,
  subtitleSettings?: unknown
) {
  const t0 = Date.now();
  const result = await exportUnifiedComposition({
    vodId,
    quality: "draft",
    preset: PRESET,
    segments,
    outputName: `${label}.mp4`,
    joinSettings: joinSettings ?? DEFAULT_COMPOSITION_JOIN_SETTINGS,
    colorSettings: colorSettings ?? parseCompositionColorSettings(null),
    subtitleSettings: subtitleSettings ?? compSubtitleSettings,
    burnSubtitles: Boolean(subtitleSettings),
  });
  return { ...result, elapsedMs: Date.now() - t0 };
}

let compSubtitleSettings: unknown = null;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const comp = getCompositionWithSegments(COMP_ID);
  if (!comp.vodId) throw new Error("composition missing vodId");
  compSubtitleSettings = comp.subtitleSettingsJson;
  const segments = buildSegments(comp);
  const report: Record<string, unknown> = {
    compositionId: COMP_ID,
    segmentCount: segments.length,
    joinCount: segments.length - 1,
  };

  console.log("=== Default (cross 0.2s) ===");
  const defaultExport = await exportCase(
    comp.vodId,
    segments,
    "c3_default_cross"
  );
  const joinTimes = joinTimesFromDurations(defaultExport.segmentDurations);
  report.default = {
    path: defaultExport.prontosPath,
    duration: await probeDuration(defaultExport.prontosPath),
    elapsedMs: defaultExport.elapsedMs,
    joinWarnings: defaultExport.joinWarnings,
    joinTimes,
    joinAudio: [] as unknown[],
  };
  for (let i = 0; i < joinTimes.length; i++) {
    const d = await joinDiscontinuity(defaultExport.prontosPath, joinTimes[i]);
    (report.default as { joinAudio: unknown[] }).joinAudio.push({
      join: i + 1,
      time: joinTimes[i],
      ...d,
    });
  }

  console.log("=== J-cut join 1, L-cut join 2 ===");
  const mixedJoins: CompositionJoinSettings = {
    ...parseCompositionJoinSettings(comp.joinSettingsJson),
    defaultOverlapSec: 0.2,
    defaultAudioMode: "cross",
    joins: [
      { audioMode: "j-cut", overlapSec: 0.2 },
      { audioMode: "l-cut", overlapSec: 0.2 },
      {},
      {},
    ],
  };
  const mixedExport = await exportCase(
    comp.vodId,
    segments,
    "c3_j1_l2",
    mixedJoins
  );
  report.mixedJl = {
    elapsedMs: mixedExport.elapsedMs,
    joinAudio: await Promise.all(
      joinTimes.map(async (t, i) => ({
        join: i + 1,
        ...(await joinDiscontinuity(mixedExport.prontosPath, t)),
      }))
    ),
  };

  console.log("=== Overlap 0.5s on join 1 ===");
  const longOverlap: CompositionJoinSettings = {
    defaultOverlapSec: 0.2,
    defaultAudioMode: "cross",
    joins: [{ overlapSec: 0.5 }],
  };
  const longExport = await exportCase(
    comp.vodId,
    segments,
    "c3_overlap_05",
    longOverlap
  );
  report.overlap05 = {
    elapsedMs: longExport.elapsedMs,
    join1: await joinDiscontinuity(longExport.prontosPath, joinTimes[0]),
  };

  console.log("=== Hard cut join 1 ===");
  const hardJoin: CompositionJoinSettings = {
    defaultOverlapSec: 0.2,
    defaultAudioMode: "cross",
    joins: [{ audioMode: "hard" }],
  };
  const hardExport = await exportCase(
    comp.vodId,
    segments,
    "c3_hard_j1",
    hardJoin
  );
  report.hardJoin1 = {
    elapsedMs: hardExport.elapsedMs,
    join1: await joinDiscontinuity(hardExport.prontosPath, joinTimes[0]),
    defaultJoin1: (report.default as { joinAudio: unknown[] }).joinAudio[0],
  };

  console.log("=== Dissolve 0.3s join 1 ===");
  const dissolveJoin: CompositionJoinSettings = {
    defaultOverlapSec: 0.2,
    defaultAudioMode: "cross",
    joins: [
      {
        videoTransition: "dissolve",
        videoTransitionSec: 0.3,
      },
    ],
  };
  const dissolveExport = await exportCase(
    comp.vodId,
    segments,
    "c3_dissolve_03",
    dissolveJoin
  );
  report.dissolve03 = {
    path: dissolveExport.prontosPath,
    elapsedMs: dissolveExport.elapsedMs,
    joinWarnings: dissolveExport.joinWarnings,
  };

  console.log("=== Transition 1s warning ===");
  const longTransition: CompositionJoinSettings = {
    defaultOverlapSec: 0.2,
    joins: [{ videoTransition: "fade", videoTransitionSec: 1 }],
  };
  const warnExport = await exportCase(
    comp.vodId,
    segments,
    "c3_fade_1s",
    longTransition
  );
  report.fade1s = {
    joinWarnings: warnExport.joinWarnings,
  };

  console.log("=== Color grade vivid ===");
  const colorExport = await exportCase(
    comp.vodId,
    segments,
    "c3_color_vivid",
    undefined,
    { enabled: true, preset: "vivid", intensityPercent: 100 },
    compSubtitleSettings
  );
  report.colorGrade = { elapsedMs: colorExport.elapsedMs };

  console.log("=== Join preview endpoint ===");
  const jp = await compositionPreviewRenderWindow({
    vodId: comp.vodId,
    preset: PRESET,
    segments,
    windowStart: Math.max(0, joinTimes[0] - 2),
    windowEnd: joinTimes[0] + 2,
    joinSettings: DEFAULT_COMPOSITION_JOIN_SETTINGS,
    subtitleSettings: compSubtitleSettings as never,
  });
  report.joinPreview = {
    cached: jp.cached,
    windowStart: jp.windowStart,
    windowEnd: jp.windowEnd,
    path: jp.previewRelativePath,
  };

  report.singlePass = true;
  report.timingCompare = {
    defaultMs: defaultExport.elapsedMs,
    mixedMs: mixedExport.elapsedMs,
    deltaMs: mixedExport.elapsedMs - defaultExport.elapsedMs,
  };

  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("Report:", path.join(OUT, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
