import fs from "fs/promises";
import path from "path";
import {
  PREVIEW_DURATION_TOLERANCE_SEC,
} from "./clipDuration";
import { probeMediaDurationSeconds } from "./mediaProbe";
import { getDataDir } from "./vodIngest";
import {
  findClipEditableById,
  type ClipEditable,
} from "./clipEditable";
import { trimPreview } from "./trimPreviewService";

type CacheEntry = {
  mtimeMs: number;
  markedDuration: number;
  probedDuration: number | null;
};

const durationCache = new Map<string, CacheEntry>();

export function clearPreviewDurationCache(): void {
  durationCache.clear();
}

export function invalidatePreviewDurationCache(previewPath: string): void {
  durationCache.delete(previewPath);
}

/** Seed cache after trimPreview (avoids ffprobe on the immediate next read). */
export function seedPreviewDurationCache(
  previewPath: string,
  markedDuration: number,
  mtimeMs: number,
  probedDuration?: number
): void {
  durationCache.set(previewPath, {
    mtimeMs,
    markedDuration,
    probedDuration: probedDuration ?? markedDuration,
  });
}

function previewAligned(
  probedDuration: number | null,
  markedDuration: number
): boolean {
  if (probedDuration == null || !(probedDuration > 0)) return false;
  return (
    Math.abs(probedDuration - markedDuration) <=
    PREVIEW_DURATION_TOLERANCE_SEC
  );
}

async function probeAndCache(
  previewPath: string,
  markedDuration: number,
  mtimeMs: number
): Promise<number | null> {
  const probedDuration = await probeMediaDurationSeconds(previewPath);
  durationCache.set(previewPath, { mtimeMs, markedDuration, probedDuration });
  return probedDuration;
}

/**
 * Returns cached/probed preview duration. ffprobe runs only on cache miss
 * (new path, changed mtime, or different marked interval).
 */
export async function resolveCachedPreviewDuration(
  previewPath: string,
  markedDuration: number
): Promise<number | null> {
  try {
    const st = await fs.stat(previewPath);
    const cached = durationCache.get(previewPath);
    if (
      cached &&
      cached.mtimeMs === st.mtimeMs &&
      Math.abs(cached.markedDuration - markedDuration) < 0.001
    ) {
      return cached.probedDuration;
    }
    return probeAndCache(previewPath, markedDuration, st.mtimeMs);
  } catch {
    return null;
  }
}

/** True when preview file exists and duration matches the marked interval. */
export async function isPreviewAligned(
  previewPath: string,
  markedDuration: number
): Promise<boolean> {
  const probed = await resolveCachedPreviewDuration(
    previewPath,
    markedDuration
  );
  return previewAligned(probed, markedDuration);
}

/**
 * Ensures previews/{id}.mp4 exists and matches [start, end]. Regenerates via
 * trimPreview when missing or duration-divergent.
 */
export async function ensurePreviewForInterval(
  editableId: string,
  start?: number,
  end?: number
): Promise<{
  previewPath: string;
  editable: ClipEditable;
  regenerated: boolean;
}> {
  let editable = await findClipEditableById(editableId);
  const intervalStart = start ?? editable.start;
  const intervalEnd = end ?? editable.end;
  const markedDuration = Math.max(0.1, intervalEnd - intervalStart);
  const previewPath = path.join(
    getDataDir(),
    editable.vodId,
    "previews",
    `${editableId}.mp4`
  );

  if (await isPreviewAligned(previewPath, markedDuration)) {
    return { previewPath, editable, regenerated: false };
  }

  invalidatePreviewDurationCache(previewPath);
  await trimPreview(editableId, intervalStart, intervalEnd);
  editable = await findClipEditableById(editableId);

  try {
    const st = await fs.stat(previewPath);
    seedPreviewDurationCache(previewPath, markedDuration, st.mtimeMs);
  } catch {
    // trimPreview succeeded; next read will probe if needed
  }

  return { previewPath, editable, regenerated: true };
}
