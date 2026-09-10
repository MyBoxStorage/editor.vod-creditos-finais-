import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "../services/vodIngest";
import { getLayoutPreset, type LayoutPreset } from "./layoutPresets";
import { getCaptionFontsDir } from "./captionGenerator";

export type RenderClipInput = {
  vodId: string;
  start: number;
  end: number;
  layoutPresetId: string;
  clipId?: string;
  /** Defaults to raw.mp4 — use e.g. hook_raw.mp4 for secondary cuts in the same clip dir. */
  rawFileName?: string;
  /** When false, skip writing clip.json (used for hook sub-renders). Default true. */
  writeClipJson?: boolean;
};

export type RenderClipResult = {
  clipId: string;
  rawPath: string;
  clipDir: string;
};

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", ...args], {
      windowsHide: true,
      shell: process.platform === "win32",
    });

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Runs ffmpeg with filter_complex, spilling to -filter_complex_script on Windows
 * or when the graph exceeds the command-line limit.
 */
export async function runFfmpegWithFilterComplex(opts: {
  inputArgs: string[];
  filterComplex: string;
  outputArgs: string[];
  scriptDir: string;
}): Promise<void> {
  const useScript =
    process.platform === "win32" || opts.filterComplex.length > 7000;
  if (!useScript) {
    await runFfmpeg([
      ...opts.inputArgs,
      "-filter_complex",
      opts.filterComplex,
      ...opts.outputArgs,
    ]);
    return;
  }
  await fs.mkdir(opts.scriptDir, { recursive: true });
  const scriptPath = path.join(opts.scriptDir, "filter_complex.txt");
  await fs.writeFile(scriptPath, opts.filterComplex, "utf-8");
  try {
    await runFfmpeg([
      ...opts.inputArgs,
      "-filter_complex_script",
      scriptPath,
      ...opts.outputArgs,
    ]);
  } finally {
    await fs.unlink(scriptPath).catch(() => undefined);
  }
}

/**
 * Layout video filter graph (no input labels for simple -vf; labeled for -filter_complex).
 * Split presets return a full filter_complex string ending in [vout].
 * Non-split returns a plain scale=… chain suitable for -vf.
 */
export function buildFilterComplex(preset: LayoutPreset): string | null {
  if (!preset.split) {
    return `scale=${preset.outputResolution.w}:${preset.outputResolution.h}`;
  }

  const ratios = preset.splitPanelRatios;
  if (!ratios) {
    throw new Error(
      `Layout preset "${preset.id}" is split but missing splitPanelRatios`
    );
  }

  const g = preset.gameplayCrop;
  const w = preset.webcamCrop;
  const outW = preset.outputResolution.w;
  const outH = preset.outputResolution.h;
  // Even dims for libx264
  const camH = Math.round((outH * ratios.webcam) / 2) * 2;
  const gameH = outH - camH;

  // crop-to-fill (object-fit: cover): scale to cover panel, then center-crop
  // Order: webcam on top (30%), gameplay below (70%) — StreamLadder reference
  return [
    `[0:v]crop=${w.w}:${w.h}:${w.x}:${w.y},scale=${outW}:${camH}:force_original_aspect_ratio=increase,crop=${outW}:${camH}[cam]`,
    `[0:v]crop=${g.w}:${g.h}:${g.x}:${g.y},scale=${outW}:${gameH}:force_original_aspect_ratio=increase,crop=${outW}:${gameH}[game]`,
    `[cam][game]vstack=inputs=2[vout]`,
  ].join(";");
}

/**
 * Cuts [start, end] from source.mp4 and applies layout crop/stack.
 * Output: data/{vodId}/clips/{clipId}/raw.mp4 (no captions yet).
 */
export async function renderClip(
  input: RenderClipInput
): Promise<RenderClipResult> {
  const { vodId, start, end, layoutPresetId } = input;

  if (!(end > start)) {
    throw new Error("end must be greater than start");
  }

  const preset = getLayoutPreset(layoutPresetId);
  if (!preset) {
    throw new Error(`Unknown layoutPresetId: ${layoutPresetId}`);
  }

  const vodDir = path.join(getDataDir(), vodId);
  const sourcePath = path.join(vodDir, "source.mp4");

  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`source.mp4 not found for vodId=${vodId}`);
  }

  const clipId = input.clipId ?? randomUUID();
  const clipDir = path.join(vodDir, "clips", clipId);
  await fs.mkdir(clipDir, { recursive: true });
  const rawPath = path.join(clipDir, input.rawFileName ?? "raw.mp4");

  const filter = buildFilterComplex(preset);
  const args: string[] = [
    "-ss",
    String(start),
    "-to",
    String(end),
    "-i",
    sourcePath,
  ];

  if (preset.split && filter) {
    args.push("-filter_complex", filter, "-map", "[vout]", "-map", "0:a?");
  } else if (filter) {
    args.push("-vf", filter, "-map", "0:v", "-map", "0:a?");
  }

  args.push("-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", rawPath);

  await runFfmpeg(args);

  if (input.writeClipJson !== false) {
    await fs.writeFile(
      path.join(clipDir, "clip.json"),
      JSON.stringify(
        {
          clipId,
          vodId,
          start,
          end,
          layoutPresetId,
          rawPath,
        },
        null,
        2
      ),
      "utf-8"
    );
  }

  return { clipId, rawPath, clipDir };
}

/**
 * Burns an .ass subtitle file onto raw.mp4 → final.mp4 (Sprint 6).
 * fontsdir points at backend/assets/fonts so Anton resolves without OS install.
 */
export async function burnCaptions(
  rawMp4Path: string,
  assPath: string,
  outputPath: string
): Promise<void> {
  const fontsDir = getCaptionFontsDir();
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const escapedFonts = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
  await runFfmpeg([
    "-i",
    rawMp4Path,
    "-vf",
    `subtitles='${escapedAss}':fontsdir='${escapedFonts}'`,
    "-c:v",
    "libx264",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/**
 * Concatenate two already-encoded clips (hook then body) via the concat demuxer.
 * Both inputs should share the same codec/resolution (same layout pipeline).
 */
export async function concatClips(
  firstMp4Path: string,
  secondMp4Path: string,
  outputPath: string
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const escapeConcatPath = (p: string) =>
    p.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const listBody = [
    `file '${escapeConcatPath(firstMp4Path)}'`,
    `file '${escapeConcatPath(secondMp4Path)}'`,
    "",
  ].join("\n");
  await fs.writeFile(listPath, listBody, "utf-8");
  try {
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }
}
