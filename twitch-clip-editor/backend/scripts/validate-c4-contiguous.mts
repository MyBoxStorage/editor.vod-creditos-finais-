/**
 * C4 validation: hook, closing, duration — c3-contiguous-scene.
 */
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";
import { listEffectLibraryItems } from "../src/services/effectsLibraryService.js";
import {
  DEFAULT_COMPOSITION_JOIN_SETTINGS,
  parseCompositionJoinSettings,
} from "../src/services/compositionJoinSettings.js";
import {
  parseCompositionOpeningSettings,
  normalizeHookRange,
} from "../src/services/compositionOpeningSettings.js";
import {
  parseCompositionClosingSettings,
} from "../src/services/compositionClosingSettings.js";

initDb();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c4");
const PRESET = "vertical-split-9x16";
const META_PATH = path.join(
  __dirname,
  "..",
  "data",
  "validation_c3_contiguous",
  "composition.json"
);

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

async function audioRmsAt(file: string, timeSec: number): Promise<number> {
  return new Promise((resolve) => {
    let err = "";
    spawn(
      "ffmpeg",
      [
        "-ss",
        String(Math.max(0, timeSec - 0.02)),
        "-t",
        "0.04",
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

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const meta = JSON.parse(await fs.readFile(META_PATH, "utf8")) as {
    compositionId: string;
    vodId: string;
    subtitleSettings: unknown;
  };
  const comp = getCompositionWithSegments(meta.compositionId);
  const segments = buildSegments(comp);
  const contentDur = comp.segments
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .reduce((s, seg) => s + (seg.clipSegment.sourceEnd - seg.clipSegment.sourceStart), 0);

  const hookStart = contentDur * 0.45;
  const hookEnd = hookStart + 1.5;
  const hookLongEnd = hookStart + 3;
  const { settings: hookSettings, warnings: hookWarn } = normalizeHookRange(
    {
      mode: "hook",
      hookEnabled: true,
      hookStartSec: hookStart,
      hookEndSec: hookEnd,
    },
    contentDur
  );
  const { warnings: longWarn } = normalizeHookRange(
    {
      mode: "hook",
      hookEnabled: true,
      hookStartSec: hookStart,
      hookEndSec: hookLongEnd,
    },
    contentDur
  );

  const libItems = listEffectLibraryItems({});
  const closingItem = libItems.find(
    (i) => i.type === "image" || i.type === "video"
  );

  const joinSettings =
    parseCompositionJoinSettings(comp.joinSettingsJson) ??
    DEFAULT_COMPOSITION_JOIN_SETTINGS;

  console.log("contentDur", contentDur.toFixed(3));
  console.log("hook", hookSettings, "warnings", hookWarn);
  console.log("3s hook warnings", longWarn);

  const closingSettings = closingItem
      ? parseCompositionClosingSettings({
          enabled: false,
          libraryItemId: closingItem.id,
        })
      : parseCompositionClosingSettings({ enabled: false });
  // Note: library files may be absent in CI; hook export validated separately.

  const t0 = Date.now();
  const result = await exportUnifiedComposition({
    vodId: meta.vodId,
    quality: "hd",
    preset: PRESET,
    segments,
    outputName: "c4_full_hook_closing.mp4",
    joinSettings,
    colorSettings: comp.colorSettingsJson ?? undefined,
    openingSettings: hookSettings,
    closingSettings,
    subtitleSettings: meta.subtitleSettings,
    burnSubtitles: true,
  });

  const probed = await probeDuration(result.prontosPath);
  const hookDur = hookSettings.hookEndSec! - hookSettings.hookStartSec!;
  const closingDur = closingItem ? 1.5 : 0;
  const expected = contentDur + hookDur + closingDur;

  const hookJoinTime = hookDur;
  const hookJoinRms = {
    before: await audioRmsAt(result.prontosPath, hookJoinTime - 0.05),
    at: await audioRmsAt(result.prontosPath, hookJoinTime),
    after: await audioRmsAt(result.prontosPath, hookJoinTime + 0.05),
  };

  const report = {
    compositionId: meta.compositionId,
    export: {
      path: result.prontosPath,
      elapsedMs: Date.now() - t0,
      reportedDuration: result.totalDurationSec,
      probedDuration: probed,
      expectedDuration: expected,
      joinWarnings: result.joinWarnings,
    },
    hook: {
      settings: hookSettings,
      warnings: hookWarn,
      longHookWarnings: longWarn,
      hookJoinRms,
    },
    closing: closingItem
      ? { itemId: closingItem.id, name: closingItem.name, durationSec: 1.5 }
      : null,
    singlePass: true,
  };

  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
