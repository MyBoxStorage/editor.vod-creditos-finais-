import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { EffectLibraryItem, EffectLibraryType } from "./effectsLibraryService";
import { getLibraryDir, resolveEffectFilePath } from "./effectsLibraryService";
import { getDataDir } from "./vodIngest";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let err = "";
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `ffmpeg exited ${code}`));
    });
  });
}

export function getPreviewDir(): string {
  return path.join(getLibraryDir(), "_previews");
}

function previewRelPath(fileName: string): string {
  return path.join("_library", "_previews", fileName).replace(/\\/g, "/");
}

export type GeneratedPreviews = {
  thumbnailPath: string | null;
  waveformPath: string | null;
};

export async function generateLibraryPreviews(
  item: Pick<EffectLibraryItem, "id" | "type">,
  absSourcePath: string
): Promise<GeneratedPreviews> {
  const previewDir = getPreviewDir();
  await fs.mkdir(previewDir, { recursive: true });

  if (item.type === "video" || item.type === "image") {
    const thumbName = `${item.id}_thumb.jpg`;
    const thumbAbs = path.join(previewDir, thumbName);
    const args =
      item.type === "video"
        ? [
            "-y",
            "-i",
            absSourcePath,
            "-ss",
            "0",
            "-vframes",
            "1",
            "-vf",
            "scale=320:-1",
            thumbAbs,
          ]
        : ["-y", "-i", absSourcePath, "-vf", "scale=320:-1", thumbAbs];
    await runFfmpeg(args);
    return { thumbnailPath: previewRelPath(thumbName), waveformPath: null };
  }

  const waveName = `${item.id}_wave.png`;
  const waveAbs = path.join(previewDir, waveName);
  await runFfmpeg([
    "-y",
    "-i",
    absSourcePath,
    "-filter_complex",
    "showwavespic=s=320x80:colors=0x38bdf8",
    "-frames:v",
    "1",
    waveAbs,
  ]);
  return { thumbnailPath: null, waveformPath: previewRelPath(waveName) };
}

export async function ensureLibraryPreviews(
  item: EffectLibraryItem
): Promise<EffectLibraryItem> {
  if (item.thumbnailPath && item.waveformPath) return item;
  if ((item.type === "video" || item.type === "image") && item.thumbnailPath) {
    return item;
  }
  if (
    item.type !== "video" &&
    item.type !== "image" &&
    item.waveformPath
  ) {
    return item;
  }

  const abs = resolveEffectFilePath(item);
  try {
    await fs.access(abs);
  } catch {
    return item;
  }

  const generated = await generateLibraryPreviews(item, abs);
  return {
    ...item,
    thumbnailPath: generated.thumbnailPath ?? item.thumbnailPath,
    waveformPath: generated.waveformPath ?? item.waveformPath,
  };
}

export function detectTypeFromFileName(fileName: string): EffectLibraryType | null {
  const ext = path.extname(fileName).toLowerCase();
  if (
    [".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(ext)
  ) {
    return "video";
  }
  if ([".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"].includes(ext)) {
    return "music";
  }
  if ([".sfx", ".opus"].includes(ext)) {
    return "sfx";
  }
  // Short sfx-like extensions fall back to sfx for common sound formats
  if (ext === ".mp3" || ext === ".wav") {
    return null; // already handled as music — caller may override
  }
  return null;
}

export function detectTypeFromExtension(
  fileName: string,
  hint?: EffectLibraryType
): EffectLibraryType {
  if (hint) return hint;
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".mkv", ".avi"].includes(ext)) return "video";
  if ([".png", ".webp", ".jpg", ".jpeg", ".gif"].includes(ext)) return "image";
  if ([".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"].includes(ext)) {
    return "music";
  }
  return "sfx";
}

export function absolutePreviewPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(getDataDir(), relativePath);
}
