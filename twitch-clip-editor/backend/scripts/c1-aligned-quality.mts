/**
 * C1 closeout: aligned quality comparison + list divergent previews.
 * Does not modify the unified pipeline.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb, getDb } from "../src/db/index.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportCandidate } from "../src/services/candidateExportService.js";
import {
  createComposition,
  exportComposition,
} from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import { trimPreview } from "../src/services/trimPreviewService.js";
import { getClipSegmentById } from "../src/services/clipSegmentsService.js";
import { getDataDir } from "../src/services/vodIngest.js";
import { findClipEditableById } from "../src/services/clipEditable.js";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c1_aligned");
const VOD = "v2820282061";
const SEG_A = "5a38accd-25ca-44bc-b0eb-1cd61dfe36a8";
const SEG_B = "4cb0313f-c5a8-4bbd-bb89-fecfad6c687f";
const PRESET = "vertical-split-9x16";
const DURATION_TOL = 0.12;

function probeDuration(file: string): Promise<number> {
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
      { windowsHide: true }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    // Drain stderr — corrupt previews can spam AAC/H264 warnings and block the pipe.
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      const duration = parseFloat(out.trim().split(/\s+/)[0] ?? "");
      if (code === 0 && Number.isFinite(duration)) {
        resolve(duration);
        return;
      }
      reject(new Error(`ffprobe failed: ${file}`));
    });
  });
}

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
  const effectEnd = effectStart + dur;
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
    if (presetId === "emphasis" || presetId === "surprise") {
      row.colorFadeSeconds = 0;
    }
  }
  if (expanded.speedRamp?.length) row.speedRamp = expanded.speedRamp;
  return row;
}

/** Build a reference video from source with layout only (no emotion presets). */
async function renderLayoutReference(opts: {
  sourcePath: string;
  segments: Array<{ vodStart: number; duration: number }>;
  outputPath: string;
}): Promise<void> {
  // Simple concat of layout-only cuts — used as "original material" baseline
  // for relative quality of the two export paths (both apply same presets).
  // For PSNR of graded exports we compare paths against each other AND
  // against a single-pass layout-only concat from source (no emotion).
  const filterParts: string[] = [];
  const args: string[] = [];
  for (let i = 0; i < opts.segments.length; i++) {
    const s = opts.segments[i];
    args.push(
      "-ss",
      String(Number(s.vodStart.toFixed(6))),
      "-t",
      String(Number(s.duration.toFixed(6))),
      "-i",
      opts.sourcePath
    );
    // vertical-split-9x16 layout (same as export)
    filterParts.push(
      `[${i}:v]crop=487:274:1433:806,scale=1080:576:force_original_aspect_ratio=increase,crop=1080:576[cam${i}];` +
        `[${i}:v]crop=1920:805:0:0,scale=1080:1344:force_original_aspect_ratio=increase,crop=1080:1344[game${i}];` +
        `[cam${i}][game${i}]vstack=inputs=2,setsar=1[sv${i}];` +
        `[${i}:a]anull[sa${i}]`
    );
  }
  const n = opts.segments.length;
  const concatIn = opts.segments
    .map((_, i) => `[sv${i}][sa${i}]`)
    .join("");
  filterParts.push(`${concatIn}concat=n=${n}:v=1:a=1[vout][aout]`);
  const filterComplex = filterParts.join(";");
  const scriptDir = path.dirname(opts.outputPath);
  await fs.mkdir(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "ref_filter.txt");
  await fs.writeFile(scriptPath, filterComplex, "utf-8");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        ...args,
        "-filter_complex_script",
        scriptPath,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-crf",
        "17",
        "-preset",
        "slow",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-movflags",
        "+faststart",
        opts.outputPath,
      ],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err.slice(-1500)));
      else resolve();
    });
  });
}

function probePsnrSsim(
  ref: string,
  dist: string
): Promise<{ psnr: number | null; ssim: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      [
        "-i",
        dist,
        "-i",
        ref,
        "-lavfi",
        "[0:v][1:v]psnr=stats_file=-;[0:v][1:v]ssim=stats_file=-",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true }
    );
    let err = "";
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("close", () => {
      // PSNR y:... u:... v:... average:XX.XX min:...
      const psnrLine = err.match(/PSNR[^\n]*average:([0-9.]+)/);
      // SSIM Y:... U:... V:... All:0.XXXX (X)
      const ssimLine = err.match(/SSIM[^\n]*All:([0-9.]+)/);
      resolve({
        psnr: psnrLine ? parseFloat(psnrLine[1]) : null,
        ssim: ssimLine ? parseFloat(ssimLine[1]) : null,
      });
    });
  });
}

async function listDivergentPreviews() {
  type DivergentItem = {
    kind: string;
    id: string;
    vodId: string;
    markedDuration: number;
    previewDuration: number | null;
    delta: number | null;
    previewPath: string;
    missing: boolean;
    orphan?: boolean;
  };

  const rows = getDb()
    .prepare(
      `SELECT id, vod_id, source_start, source_end, preview_relative_path
       FROM clip_segments
       WHERE preview_relative_path IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    vod_id: string;
    source_start: number;
    source_end: number;
    preview_relative_path: string;
  }>;

  // Also candidates table if present
  let candidates: Array<{
    id: string;
    vod_id: string;
    start: number;
    end: number;
    preview_relative_path: string | null;
  }> = [];
  try {
    candidates = getDb()
      .prepare(
        `SELECT id, vod_id, start, end, preview_relative_path FROM candidates
         WHERE preview_relative_path IS NOT NULL`
      )
      .all() as typeof candidates;
  } catch {
    candidates = [];
  }

  const divergent: DivergentItem[] = [];
  const seenPreviewPaths = new Set<string>();

  for (const r of rows) {
    const marked = r.source_end - r.source_start;
    seenPreviewPaths.add(r.preview_relative_path);
    const previewPath = path.join(
      getDataDir(),
      r.vod_id,
      r.preview_relative_path
    );
    let previewDuration: number | null = null;
    let missing = false;
    try {
      await fs.access(previewPath);
      previewDuration = await probeDuration(previewPath);
    } catch {
      missing = true;
    }
    const delta =
      previewDuration != null ? previewDuration - marked : null;
    if (
      missing ||
      (delta != null && Math.abs(delta) > DURATION_TOL)
    ) {
      divergent.push({
        kind: "clip_segment",
        id: r.id,
        vodId: r.vod_id,
        markedDuration: Number(marked.toFixed(3)),
        previewDuration:
          previewDuration != null
            ? Number(previewDuration.toFixed(3))
            : null,
        delta: delta != null ? Number(delta.toFixed(3)) : null,
        previewPath: r.preview_relative_path,
        missing,
      });
    }
  }

  for (const r of candidates) {
    if (!r.preview_relative_path) continue;
    seenPreviewPaths.add(r.preview_relative_path);
    const marked = r.end - r.start;
    const previewPath = path.join(
      getDataDir(),
      r.vod_id,
      r.preview_relative_path
    );
    let previewDuration: number | null = null;
    let missing = false;
    try {
      await fs.access(previewPath);
      previewDuration = await probeDuration(previewPath);
    } catch {
      missing = true;
    }
    const delta =
      previewDuration != null ? previewDuration - marked : null;
    if (
      missing ||
      (delta != null && Math.abs(delta) > DURATION_TOL)
    ) {
      divergent.push({
        kind: "candidate",
        id: r.id,
        vodId: r.vod_id,
        markedDuration: Number(marked.toFixed(3)),
        previewDuration:
          previewDuration != null
            ? Number(previewDuration.toFixed(3))
            : null,
        delta: delta != null ? Number(delta.toFixed(3)) : null,
        previewPath: r.preview_relative_path,
        missing,
      });
    }
  }

  // Orphan files on disk under previews/ not referenced by DB rows above.
  const previewsDir = path.join(getDataDir(), VOD, "previews");
  try {
    const files = await fs.readdir(previewsDir);
    for (const file of files) {
      if (!file.endsWith(".mp4")) continue;
      const rel = `previews/${file}`;
      if (seenPreviewPaths.has(rel)) continue;
      const previewPath = path.join(previewsDir, file);
      let previewDuration: number | null = null;
      try {
        previewDuration = await probeDuration(previewPath);
      } catch {
        previewDuration = null;
      }
      divergent.push({
        kind: "orphan_file",
        id: path.basename(file, ".mp4"),
        vodId: VOD,
        markedDuration: NaN,
        previewDuration:
          previewDuration != null
            ? Number(previewDuration.toFixed(3))
            : null,
        delta: null,
        previewPath: rel,
        missing: false,
        orphan: true,
      });
    }
  } catch {
    // previews dir may not exist for this VOD
  }

  return divergent;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const report: Record<string, unknown> = {};

  // --- Part 2 first (listing only) ---
  console.log("=== Part 2: divergent previews ===");
  const divergent = await listDivergentPreviews();
  report.divergentPreviews = {
    count: divergent.length,
    toleranceSec: DURATION_TOL,
    items: divergent,
  };
  console.log(JSON.stringify(report.divergentPreviews, null, 2));

  // --- Part 1: regenerate previews ---
  console.log("=== Part 1a: regenerate previews ===");
  const segA = getClipSegmentById(SEG_A);
  const segB = getClipSegmentById(SEG_B);
  const markedA = segA.sourceEnd - segA.sourceStart;
  const markedB = segB.sourceEnd - segB.sourceStart;

  await trimPreview(SEG_A, segA.sourceStart, segA.sourceEnd);
  await trimPreview(SEG_B, segB.sourceStart, segB.sourceEnd);

  const previewA = path.join(getDataDir(), VOD, "previews", `${SEG_A}.mp4`);
  const previewB = path.join(getDataDir(), VOD, "previews", `${SEG_B}.mp4`);
  const dPrevA = await probeDuration(previewA);
  const dPrevB = await probeDuration(previewB);

  report.previewRegen = {
    segA: { marked: markedA, preview: dPrevA, delta: dPrevA - markedA },
    segB: { marked: markedB, preview: dPrevB, delta: dPrevB - markedB },
  };
  console.log(JSON.stringify(report.previewRegen, null, 2));

  if (
    Math.abs(dPrevA - markedA) > DURATION_TOL ||
    Math.abs(dPrevB - markedB) > DURATION_TOL
  ) {
    console.error(
      "STOP: regenerated previews still diverge from marked intervals"
    );
    await fs.writeFile(
      path.join(OUT, "report.json"),
      JSON.stringify(report, null, 2)
    );
    process.exit(1);
  }

  const appA = appPayload("emphasis", 0.5, markedA);
  const appB = appPayload("celebration", 1.0, markedB);
  const base = {
    useSubtitles: false,
    subtitleRange: null as null,
    quality: "max" as const,
    speed: 1,
    preset: PRESET,
  };

  console.log("=== Part 1b: legacy export ===");
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
    name: "c1-aligned-quality",
    clipSegmentIds: [SEG_A, SEG_B],
  });
  const rConcat = await exportComposition(comp.id, "max");
  const legacyMs = Date.now() - tLegacy0;

  console.log("=== Part 1b: unified export ===");
  const tNew0 = Date.now();
  const rUnified = await exportUnifiedComposition({
    vodId: VOD,
    quality: "max",
    preset: PRESET,
    segments: [
      { clipSegmentId: SEG_A, presetApplications: [appA] as never },
      { clipSegmentId: SEG_B, presetApplications: [appB] as never },
    ],
    outputName: "c1_aligned_unified.mp4",
  });
  const newMs = Date.now() - tNew0;

  const dLegacy = await probeDuration(rConcat.prontosPath);
  const dNew = await probeDuration(rUnified.prontosPath);
  const dSegA = await probeDuration(rA.prontosPath);
  const dSegB = await probeDuration(rB.prontosPath);
  const expected = markedA + markedB;

  report.durations = {
    markedA,
    markedB,
    expectedTotal: expected,
    legacySegA: dSegA,
    legacySegB: dSegB,
    legacyConcat: dLegacy,
    unified: dNew,
    legacyVsExpected: Math.abs(dLegacy - expected),
    unifiedVsExpected: Math.abs(dNew - expected),
    legacyVsUnified: Math.abs(dLegacy - dNew),
  };
  console.log(JSON.stringify(report.durations, null, 2));

  const durationsMatch =
    Math.abs(dLegacy - expected) < DURATION_TOL &&
    Math.abs(dNew - expected) < DURATION_TOL &&
    Math.abs(dLegacy - dNew) < DURATION_TOL;

  if (!durationsMatch) {
    console.error(
      "STOP: durations still diverge — not measuring PSNR/SSIM"
    );
    report.stopped = true;
    report.stopReason = "duration mismatch after preview regen";
    await fs.writeFile(
      path.join(OUT, "report.json"),
      JSON.stringify(report, null, 2)
    );
    process.exit(1);
  }

  console.log("=== Part 1d: layout-only reference from source ===");
  const sourcePath = path.join(getDataDir(), VOD, "source.mp4");
  const refPath = path.join(OUT, "layout_ref.mp4");
  await renderLayoutReference({
    sourcePath,
    segments: [
      { vodStart: segA.sourceStart, duration: markedA },
      { vodStart: segB.sourceStart, duration: markedB },
    ],
    outputPath: refPath,
  });
  const dRef = await probeDuration(refPath);

  console.log("=== Part 1d: PSNR/SSIM ===");
  // Against each other (same content expected)
  const vsEachOther = await probePsnrSsim(
    rConcat.prontosPath,
    rUnified.prontosPath
  );
  // Each vs layout-only reference (no emotion grade — measures encode degradation
  // relative to a clean single-pass layout cut; both paths apply same presets so
  // absolute scores are low, but relative ranking still informative)
  const legacyVsRef = await probePsnrSsim(refPath, rConcat.prontosPath);
  const unifiedVsRef = await probePsnrSsim(refPath, rUnified.prontosPath);

  report.quality = {
    refDuration: dRef,
    note:
      "Reference is layout-only single-pass from source (no emotion presets). " +
      "Both exports apply the same presets, so absolute PSNR vs ref is limited by " +
      "preset differences; relative ranking still shows encode generation cost. " +
      "Also report pairwise PSNR between the two exports (aligned content).",
    pairwise: {
      unifiedVsLegacy: vsEachOther,
    },
    vsLayoutReference: {
      legacy: legacyVsRef,
      unified: unifiedVsRef,
    },
    timing: { legacyMs, unifiedMs: newMs },
    sizes: {
      legacy: (await fs.stat(rConcat.prontosPath)).size,
      unified: (await fs.stat(rUnified.prontosPath)).size,
      ref: (await fs.stat(refPath)).size,
    },
  };
  console.log(JSON.stringify(report.quality, null, 2));

  // Paths that still read previews (for report section 2b)
  report.previewConsumers = [
    "exportCandidate — reads previews/{id}.mp4 as source material",
    "previewRenderService / renderFaithfulPreviewWindow — same",
    "trimPreview — writes them; called on access miss",
    "unified export — does NOT use previews/; reads source.mp4",
    "exportComposition — uses already-exported MP4s, not previews/",
  ];

  await fs.writeFile(
    path.join(OUT, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log("Wrote", path.join(OUT, "report.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
