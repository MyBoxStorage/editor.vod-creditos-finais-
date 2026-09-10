/**
 * C3 contiguous-scene validation: audio RMS, subtitles, color conflict.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import {
  DEFAULT_COMPOSITION_JOIN_SETTINGS,
  resolveJoinSettings,
  parseCompositionJoinSettings,
  type CompositionJoinSettings,
} from "../src/services/compositionJoinSettings.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c3_contiguous");
const PRESET = "vertical-split-9x16";
const META_PATH = path.join(OUT, "composition.json");

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    spawn(
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
    )
      .stdout!.on("data", (c: Buffer) => (out += c.toString()))
      .on("close", (code) =>
        code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
      );
  });
}

async function audioRmsAt(
  file: string,
  timeSec: number,
  windowSec = 0.04
): Promise<number> {
  const start = Math.max(0, timeSec - windowSec / 2);
  return new Promise((resolve) => {
    let err = "";
    spawn(
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
    )
      .stderr!.on("data", (c: Buffer) => (err += c.toString()))
      .on("close", () => {
        const m = err.match(/mean_volume:\s*([-\d.]+)\s*dB/);
        resolve(m ? parseFloat(m[1]) : -91);
      });
  });
}

async function joinRms(file: string, joinTime: number) {
  const beforeDb = await audioRmsAt(file, joinTime - 0.025);
  const atDb = await audioRmsAt(file, joinTime);
  const afterDb = await audioRmsAt(file, joinTime + 0.025);
  return {
    beforeDb,
    atDb,
    afterDb,
    deltaDb: Math.abs(beforeDb - afterDb),
    jumpDb: Math.max(
      Math.abs(beforeDb - atDb),
      Math.abs(atDb - afterDb)
    ),
  };
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

function joinTimes(durs: number[]): number[] {
  const t: number[] = [];
  let acc = 0;
  for (let i = 0; i < durs.length - 1; i++) {
    acc += durs[i];
    t.push(Number(acc.toFixed(3)));
  }
  return t;
}

async function exportCase(
  vodId: string,
  segments: ReturnType<typeof buildSegments>,
  label: string,
  opts: {
    joinSettings?: CompositionJoinSettings;
    colorSettings?: unknown;
    subtitleSettings?: unknown;
    segmentPresets?: Record<number, unknown[]>;
  } = {}
) {
  const segs = segments.map((s, i) => ({
    ...s,
    presetApplications:
      opts.segmentPresets?.[i] ?? s.presetApplications,
  }));
  const t0 = Date.now();
  const result = await exportUnifiedComposition({
    vodId,
    quality: "hd",
    preset: PRESET,
    segments: segs,
    outputName: `${label}.mp4`,
    joinSettings: opts.joinSettings ?? DEFAULT_COMPOSITION_JOIN_SETTINGS,
    colorSettings: opts.colorSettings,
    subtitleSettings: opts.subtitleSettings,
    burnSubtitles: Boolean(opts.subtitleSettings),
  });
  return { ...result, elapsedMs: Date.now() - t0 };
}

async function extractJoinWav(
  mp4: string,
  joinTime: number,
  outWav: string,
  pad = 0.5
) {
  await fs.mkdir(path.dirname(outWav), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(Math.max(0, joinTime - pad)),
        "-t",
        String(pad * 2),
        "-i",
        mp4,
        "-vn",
        "-ac",
        "1",
        outWav,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    ).on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`extract ${outWav}`))
    );
  });
}

async function extractFrame(mp4: string, time: number, png: string) {
  await fs.mkdir(path.dirname(png), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(time),
        "-i",
        mp4,
        "-frames:v",
        "1",
        png,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    ).on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`frame ${png}`))
    );
  });
}

async function main() {
  const meta = JSON.parse(await fs.readFile(META_PATH, "utf8")) as {
    compositionId: string;
    vodId: string;
    subtitleSettings: unknown;
  };
  const comp = getCompositionWithSegments(meta.compositionId);
  const segments = buildSegments(comp);
  const bounds = comp.segments
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => {
      const cs = s.clipSegment;
      return {
        vodStart: cs.sourceStart,
        vodEnd: cs.sourceEnd,
        materialStart: cs.originalSourceStart ?? cs.sourceStart,
        materialEnd: cs.originalSourceEnd ?? cs.sourceEnd,
        dur: cs.sourceEnd - cs.sourceStart,
      };
    });
  const durs = bounds.map((b) => b.dur);
  const joins = resolveJoinSettings(
    parseCompositionJoinSettings(null),
    bounds,
    durs
  );
  const times = joinTimes(durs);

  console.log("joins resolved", JSON.stringify(joins, null, 2));
  console.log("join times", times, "total", durs.reduce((a, b) => a + b, 0));

  const report: Record<string, unknown> = {
    compositionId: meta.compositionId,
    joinTimes: times,
    resolvedJoins: joins,
    rms: {} as Record<string, unknown>,
  };

  // a) default cross
  console.log("\n=== default cross ===");
  const def = await exportCase(meta.vodId, segments, "val_default_cross");
  const defRms: unknown[] = [];
  for (let i = 0; i < times.length; i++) {
    const r = await joinRms(def.prontosPath, times[i]);
    await extractJoinWav(
      def.prontosPath,
      times[i],
      path.join(OUT, "audio", `default_join${i + 1}.wav`)
    );
    defRms.push({ join: i + 1, time: times[i], ...r });
  }
  (report.rms as Record<string, unknown>).default_cross = defRms;

  // b) all hard
  console.log("=== all hard ===");
  const hardSettings: CompositionJoinSettings = {
    defaultAudioMode: "cross",
    joins: times.map(() => ({ audioMode: "hard" as const })),
  };
  const hard = await exportCase(meta.vodId, segments, "val_all_hard", {
    joinSettings: hardSettings,
  });
  const hardRms: unknown[] = [];
  for (let i = 0; i < times.length; i++) {
    const r = await joinRms(hard.prontosPath, times[i]);
    await extractJoinWav(
      hard.prontosPath,
      times[i],
      path.join(OUT, "audio", `hard_join${i + 1}.wav`)
    );
    hardRms.push({ join: i + 1, time: times[i], ...r });
  }
  (report.rms as Record<string, unknown>).all_hard = hardRms;

  // c) J-cut emenda 1, L-cut emenda 2
  console.log("=== J1 L2 ===");
  const jlSettings: CompositionJoinSettings = {
    defaultAudioMode: "cross",
    joins: [
      { audioMode: "j-cut", overlapSec: 0.2 },
      { audioMode: "l-cut", overlapSec: 0.2 },
      {},
      {},
    ],
  };
  const jl = await exportCase(meta.vodId, segments, "val_j1_l2", {
    joinSettings: jlSettings,
  });
  const jlRms: unknown[] = [];
  for (let i = 0; i < times.length; i++) {
    jlRms.push({
      join: i + 1,
      ...(await joinRms(jl.prontosPath, times[i])),
    });
  }
  (report.rms as Record<string, unknown>).j1_l2 = jlRms;

  // d) overlap 0.1, 0.2, 0.5 on emenda 2 (join index 1 @ 10s)
  for (const ov of [0.1, 0.2, 0.5]) {
    console.log(`=== overlap ${ov} join2 ===`);
    const js: CompositionJoinSettings = {
      defaultAudioMode: "cross",
      joins: [{}, { overlapSec: ov, audioMode: "cross" }],
    };
    const ex = await exportCase(meta.vodId, segments, `val_ov${ov}_j2`, {
      joinSettings: js,
    });
    (report.rms as Record<string, unknown>)[`overlap_${ov}_join2`] = {
      ...(await joinRms(ex.prontosPath, times[1])),
      effectiveOverlap: joins[1]?.effectiveOverlapSec,
      path: ex.prontosRelativePath,
    };
    await extractJoinWav(
      ex.prontosPath,
      times[1],
      path.join(OUT, "audio", `overlap_${ov}_join2.wav`)
    );
  }

  // subtitles export
  console.log("=== subtitles ===");
  const sub = await exportCase(meta.vodId, segments, "val_subtitles", {
    subtitleSettings: meta.subtitleSettings,
  });
  report.subtitles = {
    path: sub.prontosPath,
    duration: await probeDuration(sub.prontosPath),
    frames: [] as string[],
  };
  // frames at ~1s into each segment on timeline: 1, 6, 11, 16
  for (const t of [1, 6, 11, 16]) {
    const png = path.join(OUT, "frames", `subtitle_t${t}.png`);
    await extractFrame(sub.prontosPath, t, png);
    (report.subtitles as { frames: string[] }).frames.push(png);
  }
  // frame in gap between speech (segment 3 start ~10s + silent)
  await extractFrame(sub.prontosPath, 10.5, path.join(OUT, "frames", "subtitle_gap_10.5.png"));

  // color + wasted on segment 2
  console.log("=== color vs wasted ===");
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
    ...(wastedApp.colorPreset !== "none"
      ? {
          colorPreset: wastedApp.colorPreset,
          colorEffectStart: 0.5,
          colorEffectEnd: 4.5,
        }
      : {}),
  };
  const color = await exportCase(meta.vodId, segments, "val_color_wasted", {
    colorSettings: { enabled: true, preset: "vivid", intensityPercent: 100 },
    segmentPresets: { 1: [wastedPayload] },
  });
  await extractFrame(color.prontosPath, 7, path.join(OUT, "frames", "color_wasted_seg2.png"));
  report.colorConflict = {
    path: color.prontosPath,
    frame: path.join(OUT, "frames", "color_wasted_seg2.png"),
  };

  report.timings = {
    defaultMs: def.elapsedMs,
    hardMs: hard.elapsedMs,
    subtitlesMs: sub.elapsedMs,
  };

  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\nReport written", path.join(OUT, "report.json"));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
