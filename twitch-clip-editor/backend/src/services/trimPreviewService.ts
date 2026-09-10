import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { runFfmpeg } from "../pipeline/clipRenderer";
import { getQualityPreset } from "./qualityPresets";
import {
  findClipEditableById,
  saveClipEditable,
  type ClipEditable,
} from "./clipEditable";
import { assertSegmentDurationAllowed } from "./segmentDurationPolicy";
import { seedPreviewDurationCache } from "./previewIntegrity";

export type TrimPreviewResult = {
  /** Editable entity (candidate or clip_segment) — same shape for API responses. */
  candidate: ClipEditable;
  previewPath: string;
  previewUrlPath: string;
  /** Always false — preview trim re-encodes for frame-accurate duration. */
  usedCopy: boolean;
};

/**
 * Fast trimmed preview of source.mp4 → data/{vodId}/previews/{id}.mp4
 * Works for marked candidates and clip_segments (universal id lookup).
 *
 * Re-encodes with NVENC so duration matches the marked interval (±1 frame).
 * Stream copy only cuts on keyframes and can overshoot by seconds.
 */
export async function trimPreview(
  editableId: string,
  start: number,
  end: number
): Promise<TrimPreviewResult> {
  assertSegmentDurationAllowed(start, end);

  const editable = { ...(await findClipEditableById(editableId)) };
  const vodId = editable.vodId;
  const duration = end - start;

  const vodDir = path.join(getDataDir(), vodId);
  const sourcePath = path.join(vodDir, "source.mp4");
  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`source.mp4 not found for vodId=${vodId}`);
  }

  const previewsDir = path.join(vodDir, "previews");
  await fs.mkdir(previewsDir, { recursive: true });
  const previewPath = path.join(previewsDir, `${editableId}.mp4`);
  const tempPreviewPath = path.join(previewsDir, `${editableId}.tmp.mp4`);

  const quality = getQualityPreset("draft");
  if (!quality) {
    throw new Error("draft quality preset missing");
  }

  try {
    await runFfmpeg([
      "-ss",
      String(Number(start.toFixed(6))),
      "-i",
      sourcePath,
      "-t",
      String(Number(duration.toFixed(6))),
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p4",
      "-tune",
      "ll",
      "-cq",
      String(Math.min(quality.crf + 6, 32)),
      "-c:a",
      "aac",
      "-b:a",
      quality.audioBitrate,
      "-movflags",
      "+faststart",
      tempPreviewPath,
    ]);

    const st = await fs.stat(tempPreviewPath);
    if (!(st.size > 0)) {
      throw new Error(`Preview file is empty at ${tempPreviewPath}`);
    }

    try {
      await fs.rename(tempPreviewPath, previewPath);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as NodeJS.ErrnoException).code)
          : "";
      if (code === "EPERM" || code === "EEXIST") {
        await fs.unlink(previewPath).catch(() => undefined);
        await fs.rename(tempPreviewPath, previewPath);
      } else {
        throw err;
      }
    }
  } catch (err) {
    await fs.unlink(tempPreviewPath).catch(() => undefined);
    throw err;
  }

  if (editable.originalStart == null) {
    editable.originalStart = editable.start;
  }
  if (editable.originalEnd == null) {
    editable.originalEnd = editable.end;
  }
  editable.start = start;
  editable.end = end;
  editable.status = "trimmed";
  editable.previewRelativePath = `previews/${editableId}.mp4`;

  await saveClipEditable(editable);

  const st = await fs.stat(previewPath);
  seedPreviewDurationCache(previewPath, duration, st.mtimeMs);

  return {
    candidate: editable,
    previewPath,
    previewUrlPath: `/media/${vodId}/previews/${editableId}.mp4`,
    usedCopy: false,
  };
}
