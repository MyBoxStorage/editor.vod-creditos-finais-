/**
 * Validate background removal modes + video overlay loop.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb, getDb } from "../src/db/index.js";
import {
  createEffectLibraryItem,
  applyEffectToClip,
  removeEffectFromClip,
  listEffectsForClip,
  getEffectLibraryItemById,
} from "../src/services/effectsLibraryService.js";
import { exportCandidate } from "../src/services/candidateExportService.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_bg_removal");
const LETTERING = path.join(OUT, "lettering-3s.mp4");
const META_PATH = path.join(
  __dirname,
  "..",
  "data",
  "validation_c3_contiguous",
  "composition.json"
);

async function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    spawn(cmd, args, {
      windowsHide: true,
      shell: process.platform === "win32",
    }).on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))
    );
  });
}

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const p = spawn(
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
    p.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    p.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error(`ffprobe ${code} ${file}`))
    );
  });
}

async function extractFrame(video: string, t: number, out: string) {
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(t),
    "-i",
    video,
    "-frames:v",
    "1",
    out,
  ]);
}

async function meanLuma(png: string): Promise<number> {
  const buf = await fs.readFile(png);
  // crude: sample file size as proxy — use ffmpeg signalstats instead
  return buf.length;
}

async function frameBlackRatio(video: string, t: number): Promise<number> {
  const tmp = path.join(OUT, `_probe_${t}.png`);
  await extractFrame(video, t, tmp);
  return new Promise((resolve) => {
    let err = "";
    spawn(
      "ffmpeg",
      [
        "-i",
        tmp,
        "-vf",
        "signalstats,metadata=print:file=-",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    )
      .stderr!.on("data", (c: Buffer) => (err += c.toString()))
      .on("close", () => {
        const m = err.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
        resolve(m ? parseFloat(m[1]) : -1);
      });
  });
}

async function clearClipEffects(candidateId: string) {
  const effects = await listEffectsForClip(candidateId);
  for (const e of effects) {
    await removeEffectFromClip(candidateId, e.id);
  }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  try {
    await fs.access(LETTERING);
  } catch {
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:d=3",
      "-vf",
      "drawtext=fontfile=C\\\\:/Windows/Fonts/arialbd.ttf:text='CANAL':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      LETTERING,
    ]);
  }

  const meta = JSON.parse(await fs.readFile(META_PATH, "utf8"));
  const comp = getCompositionWithSegments(meta.compositionId);
  const seg = comp.segments.sort((a, b) => a.orderIndex - b.orderIndex)[0];
  const candidateId = seg.clipSegment.id;
  const vodId = meta.vodId;
  const clipDur = seg.clipSegment.sourceEnd - seg.clipSegment.sourceStart;

  const modes = ["chroma", "solid", "luminance", "screen"] as const;
  const itemIds: Record<string, string> = {};
  const exports: Record<string, unknown> = {};

  for (const mode of modes) {
    const dest = path.join(OUT, `lettering-${mode}.mp4`);
    await fs.copyFile(LETTERING, dest);
    const item = await createEffectLibraryItem({
      type: "video",
      name: `Lettering test ${mode}`,
      tempFilePath: dest,
      originalFileName: `lettering-${mode}.mp4`,
      backgroundRemovalMode: mode,
      chromaKeyColor: "#000000",
      chromaKeySimilarity: 0.15,
      chromaKeyBlend: 0.08,
      skipPreviews: true,
    });
    itemIds[mode] = item.id;
  }

  const baseExport = {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft" as const,
    speed: 1,
    preset: "vertical-split-9x16",
  };

  for (const mode of modes) {
    await clearClipEffects(candidateId);
    await applyEffectToClip(candidateId, {
      effectLibraryItemId: itemIds[mode],
      sourceTrimStart: 0,
      sourceTrimEnd: 3,
      clipTimestamp: 0,
      positionX: 5,
      positionY: 35,
      positionWidth: 90,
      positionHeight: 25,
      videoLoopEnabled: false,
    });

    const result = await exportCandidate(candidateId, baseExport);
    const outPath = result.prontosPath;
    const saved = path.join(OUT, `export_${mode}.mp4`);
    await fs.copyFile(outPath, saved);
    const dur = await probeDuration(saved);
    const yMid = await frameBlackRatio(saved, 1.5);
    const yLate = await frameBlackRatio(saved, Math.min(clipDur - 0.5, 4));
    await extractFrame(saved, 1.5, path.join(OUT, `frame_${mode}_1.5.png`));
    exports[mode] = { path: saved, duration: dur, yAvgMid: yMid, yAvgLate: yLate };
  }

  // Loop test with screen mode
  await clearClipEffects(candidateId);
  const loopDest = path.join(OUT, "lettering-loop.mp4");
  await fs.copyFile(LETTERING, loopDest);
  const loopItem = await createEffectLibraryItem({
    type: "video",
    name: "Lettering loop screen",
    tempFilePath: loopDest,
    originalFileName: "lettering-loop.mp4",
    backgroundRemovalMode: "screen",
    chromaKeyColor: "#000000",
    skipPreviews: true,
  });
  await applyEffectToClip(candidateId, {
    effectLibraryItemId: loopItem.id,
    sourceTrimStart: 0,
    sourceTrimEnd: 3,
    clipTimestamp: 0,
    positionWidth: 100,
    positionHeight: 100,
    videoLoopEnabled: true,
  });

  const loopResult = await exportCandidate(candidateId, baseExport);
  const loopSaved = path.join(OUT, "export_loop_screen.mp4");
  await fs.copyFile(loopResult.prontosPath, loopSaved);
  const loopDur = await probeDuration(loopSaved);
  const loopSamples: Record<string, number> = {};
  for (const t of [1.5, 3.0, 3.05, 4.5]) {
    if (t < loopDur) {
      loopSamples[String(t)] = await frameBlackRatio(loopSaved, t);
      await extractFrame(
        loopSaved,
        t,
        path.join(OUT, `loop_frame_${t.toFixed(2).replace(".", "_")}.png`)
      );
    }
  }

  // Green chroma regression
  const greenRows = getDb()
    .prepare(
      `SELECT id, name, chroma_key_color, background_removal_mode FROM audio_library
       WHERE type='video' AND (chroma_key_color LIKE '%00FF00%' OR chroma_key_color LIKE '%00ff00%' OR name LIKE '%Green%' OR name LIKE '%green%')
       LIMIT 5`
    )
    .all() as Array<{
    id: string;
    name: string;
    chroma_key_color: string | null;
    background_removal_mode: string | null;
  }>;

  let greenExport: unknown = null;
  if (greenRows.length > 0) {
    const green = greenRows[0];
    await clearClipEffects(candidateId);
    await applyEffectToClip(candidateId, {
      effectLibraryItemId: green.id,
      sourceTrimStart: 0,
      sourceTrimEnd: 2,
      clipTimestamp: 2,
      positionWidth: 40,
      positionHeight: 40,
      videoLoopEnabled: false,
    });
    const gResult = await exportCandidate(candidateId, baseExport);
    greenExport = {
      item: green,
      parsedMode: getEffectLibraryItemById(green.id).backgroundRemovalMode,
      path: gResult.prontosPath,
    };
    await extractFrame(gResult.prontosPath, 2.5, path.join(OUT, "frame_green_chroma.png"));
  }

  await clearClipEffects(candidateId);

  const report = {
    candidateId,
    vodId,
    clipDurationSec: clipDur,
    letteringDurationSec: 3,
    exports,
    loop: {
      path: loopSaved,
      exportDuration: loopDur,
      clipDurationSec: clipDur,
      samples: loopSamples,
    },
    greenChroma: greenExport,
    greenCandidates: greenRows,
  };

  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
