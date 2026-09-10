/**
 * C1 validation — unified composition export vs exportCandidate + exportComposition.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportCandidate } from "../src/services/candidateExportService.js";
import { exportComposition, createComposition } from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import {
  compositionPreviewRenderWindow,
} from "../src/services/compositionPreviewRenderService.js";
import { remapCompositionSubtitleWords } from "../src/services/compositionSubtitleRemap.js";
import type { TimedWord } from "../src/pipeline/subtitleTiming.js";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c1");
const VOD = "v2820282061";
const SEG_A = "5a38accd-25ca-44bc-b0eb-1cd61dfe36a8"; // 2s
const SEG_B = "4cb0313f-c5a8-4bbd-bb89-fecfad6c687f"; // 5s
const SEG_C = "8751ebf7-4dc4-48a5-b6bd-ffc266f9898c"; // 6s — for 3-seg + wasted test
const PRESET = "vertical-split-9x16";

function appPayload(
  presetId: Parameters<typeof expandEmotionPreset>[0]["presetId"],
  effectStart: number,
  clipDuration: number
) {
  const dur =
    presetId === "wasted"
      ? Math.min(3, clipDuration - effectStart - 0.2)
      : presetId === "emphasis"
        ? 0.4
        : presetId === "celebration"
          ? 0.9
          : 1;
  const effectEnd =
    presetId === "wasted"
      ? effectStart + dur
      : effectStart + dur;
  const expanded = expandEmotionPreset({
    presetId,
    effectStart,
    effectEnd,
    effectDuration: presetId === "wasted" ? dur : undefined,
    clipDuration,
    intensityPercent: 100,
  });
  const row: Record<string, unknown> = {
    presetId,
    effectStart,
    effectEnd,
    intensityPercent: 100,
  };
  if (presetId === "wasted") row.effectDuration = dur;
  if (expanded.zoomKeyframes?.length) row.zoomKeyframes = expanded.zoomKeyframes;
  if (expanded.colorPreset && expanded.colorPreset !== "none") {
    row.colorPreset = expanded.colorPreset;
    row.colorEffectStart = effectStart;
    row.colorEffectEnd = effectEnd;
    if (presetId === "emphasis" || presetId === "surprise") row.colorFadeSeconds = 0;
  }
  if (expanded.speedRamp?.length) row.speedRamp = expanded.speedRamp;
  return row;
}

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

async function probePsnr(ref: string, dist: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      [
        "-i",
        dist,
        "-i",
        ref,
        "-lavfi",
        "psnr=stats_file=-",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("close", () => {
      const m = err.match(/average:\s*([\d.]+)/);
      resolve(m ? parseFloat(m[1]) : null);
    });
  });
}

async function statSize(file: string): Promise<number> {
  return (await fs.stat(file)).size;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const report: Record<string, unknown> = {};

  const base = {
    useSubtitles: false,
    subtitleRange: null as null,
    quality: "max" as const,
    speed: 1,
    preset: PRESET,
  };

  const segADur = 2;
  const segBDur = 5;
  const appA = appPayload("emphasis", 0.5, segADur);
  const appB = appPayload("celebration", 1.0, segBDur);

  console.log("=== Items 1-7: two segments with presets ===");
  const tLegacy0 = Date.now();

  const rA = await exportCandidate(SEG_A, {
    ...base,
    presetApplications: [appA] as never,
  });
  const rB = await exportCandidate(SEG_B, {
    ...base,
    presetApplications: [appB] as never,
  });

  const comp = createComposition({
    vodId: VOD,
    name: "c1-validation",
    clipSegmentIds: [SEG_A, SEG_B],
  });
  const rConcat = await exportComposition(comp.id, "max");
  const legacyMs = Date.now() - tLegacy0;

  const tNew0 = Date.now();
  const rUnified = await exportUnifiedComposition({
    vodId: VOD,
    quality: "max",
    preset: PRESET,
    segments: [
      { clipSegmentId: SEG_A, presetApplications: [appA] as never },
      { clipSegmentId: SEG_B, presetApplications: [appB] as never },
    ],
    outputName: "c1_unified_two_seg.mp4",
  });
  const newMs = Date.now() - tNew0;

  const dLegacy = await probeDuration(rConcat.prontosPath);
  const dNew = await probeDuration(rUnified.prontosPath);
  const sLegacy = await statSize(rConcat.prontosPath);
  const sNew = await statSize(rUnified.prontosPath);
  const psnr = await probePsnr(rConcat.prontosPath, rUnified.prontosPath);

  report.items_1_7 = {
    legacy: {
      path: rConcat.prontosPath,
      duration: dLegacy,
      bytes: sLegacy,
      segA: rA.prontosPath,
      segB: rB.prontosPath,
      segADuration: await probeDuration(rA.prontosPath),
      segBDuration: await probeDuration(rB.prontosPath),
      elapsedMs: legacyMs,
    },
    unified: {
      path: rUnified.prontosPath,
      duration: dNew,
      bytes: sNew,
      elapsedMs: newMs,
    },
    durationDelta: Math.abs(dLegacy - dNew),
    durationMatch: Math.abs(dLegacy - dNew) < 0.15,
    psnrDb: psnr,
    visualNote:
      "Unified path: single libx264 generation. Legacy: two segment encodes + concat copy.",
  };

  console.log(JSON.stringify(report.items_1_7, null, 2));

  console.log("=== Item 8: three segments with Wasted ===");
  const appW = appPayload("wasted", 1.0, 6);
  const t8 = Date.now();
  const rThree = await exportUnifiedComposition({
    vodId: VOD,
    quality: "max",
    preset: PRESET,
    segments: [
      { clipSegmentId: SEG_A, presetApplications: [appA] as never },
      { clipSegmentId: SEG_B, presetApplications: [appB] as never },
      { clipSegmentId: SEG_C, presetApplications: [appW] as never },
    ],
    outputName: "c1_unified_three_wasted.mp4",
  });
  report.item_8 = {
    path: rThree.prontosPath,
    duration: await probeDuration(rThree.prontosPath),
    expectedApprox: 2 + 5 + 6,
    elapsedMs: Date.now() - t8,
  };
  console.log(JSON.stringify(report.item_8, null, 2));

  console.log("=== Items 9-10: subtitle remapping ===");
  const words1: TimedWord[] = [
    { word: "a", start: 0.5, end: 1.0 },
    { word: "b", start: 1.5, end: 2.0, highlight: true },
  ];
  const words2: TimedWord[] = [
    { word: "c", start: 0.3, end: 0.9 },
    { word: "d", start: 1.2, end: 1.8 },
  ];
  const remapped = remapCompositionSubtitleWords([
    { finalStart: 0, finalEnd: 2, words: words1 },
    { finalStart: 0, finalEnd: 5, words: words2 },
  ]);
  const trimmed = remapCompositionSubtitleWords([
    { finalStart: 1, finalEnd: 2, words: words1 },
    { finalStart: 0, finalEnd: 5, words: words2 },
  ]);
  report.items_9_10 = {
    remappedSecondStart: remapped.find((w) => w.word === "c")?.start,
    expectedSecondStart: 2.3,
    trimmedSecondStart: trimmed.find((w) => w.word === "c")?.start,
    expectedTrimmedSecondStart: 1.3,
    discardedWord: trimmed.some((w) => w.word === "a"),
    highlightKept: remapped.some((w) => w.highlight),
  };
  console.log(JSON.stringify(report.items_9_10, null, 2));

  console.log("=== Items 11-12: faithful preview cache ===");
  const previewBody = {
    vodId: VOD,
    preset: PRESET,
    segments: [
      { clipSegmentId: SEG_A, presetApplications: [appA] as never },
      { clipSegmentId: SEG_B, presetApplications: [appB] as never },
    ],
    windowStart: 1,
    windowEnd: 4,
  };
  const p1 = await compositionPreviewRenderWindow(previewBody);
  const p2 = await compositionPreviewRenderWindow(previewBody);
  const reversed = await compositionPreviewRenderWindow({
    ...previewBody,
    segments: [
      { clipSegmentId: SEG_B, presetApplications: [appB] as never },
      { clipSegmentId: SEG_A, presetApplications: [appA] as never },
    ],
  });
  report.items_11_12 = {
    firstCall: { cached: p1.cached, elapsedMs: p1.elapsedMs, cacheKey: p1.cacheKey },
    secondCall: { cached: p2.cached, elapsedMs: p2.elapsedMs, cacheKey: p2.cacheKey },
    reversedKey: reversed.cacheKey,
    hashChangesOnReorder: reversed.cacheKey !== p1.cacheKey,
  };
  console.log(JSON.stringify(report.items_11_12, null, 2));

  await fs.writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log("Report written to", path.join(OUT, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
