import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { runFfmpeg } from "../pipeline/clipRenderer";
import { findMarkedCandidateById } from "./markedCandidatesService";
import { ensurePreviewForInterval } from "./previewIntegrity";

export type CandidateThumbnailResult = {
  vodId: string;
  candidateId: string;
  thumbPath: string;
  thumbUrlPath: string;
  cached: boolean;
};

/**
 * Frame at the midpoint of the candidate range.
 * Cached at data/{vodId}/thumbnails/{id}.jpg — regenerate only if missing.
 * Prefers preview when present; otherwise seeks into source.mp4.
 */
export async function getOrCreateCandidateThumbnail(
  candidateId: string
): Promise<CandidateThumbnailResult> {
  const found = await findMarkedCandidateById(candidateId);
  const { vodId, candidate } = found;

  if (!(candidate.end > candidate.start)) {
    throw new Error("candidate end must be greater than start");
  }

  const vodDir = path.join(getDataDir(), vodId);
  const thumbsDir = path.join(vodDir, "thumbnails");
  await fs.mkdir(thumbsDir, { recursive: true });
  const thumbPath = path.join(thumbsDir, `${candidateId}.jpg`);
  const thumbUrlPath = `/media/${vodId}/thumbnails/${candidateId}.jpg`;

  try {
    await fs.access(thumbPath);
    return {
      vodId,
      candidateId,
      thumbPath,
      thumbUrlPath,
      cached: true,
    };
  } catch {
    // generate below
  }

  const midOffset = (candidate.end - candidate.start) / 2;
  const { previewPath } = await ensurePreviewForInterval(
    candidateId,
    candidate.start,
    candidate.end
  );
  const sourcePath = previewPath;
  const seekSeconds = midOffset;

  await runFfmpeg([
    "-ss",
    String(seekSeconds),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    thumbPath,
  ]);

  return {
    vodId,
    candidateId,
    thumbPath,
    thumbUrlPath,
    cached: false,
  };
}
