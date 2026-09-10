import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { getCurrentRun } from "./pipelineRun";
import { runFfmpeg } from "../pipeline/clipRenderer";
import {
  findMarkedCandidateById,
  type MarkedCandidate,
} from "./markedCandidatesService";
import {
  getQualityPreset,
  type QualityEncode,
  type QualityId,
} from "./qualityPresets";

export type MergeCandidatesInput = {
  candidateIds: string[];
  quality: QualityId;
};

export type MergeCandidatesResult = {
  vodId: string;
  runId: string;
  candidateIds: string[];
  prontosPath: string;
  prontosRelativePath: string;
  targetResolution: { w: number; h: number };
  normalized: boolean;
  elapsedMs: number;
};

type ProbeInfo = {
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
};

function probeMedia(filePath: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height,codec_name,codec_type",
        "-of",
        "json",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e) => {
      reject(new Error(`Failed to start ffprobe: ${e.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffprobe failed for ${filePath}: ${err.slice(-500)}`)
        );
        return;
      }
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
          }>;
        };
        const streams = parsed.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        if (
          !video ||
          typeof video.width !== "number" ||
          typeof video.height !== "number" ||
          !video.codec_name
        ) {
          reject(new Error(`No video stream in ${filePath}`));
          return;
        }
        resolve({
          width: video.width,
          height: video.height,
          videoCodec: video.codec_name,
          audioCodec: audio?.codec_name ?? null,
        });
      } catch (e) {
        reject(
          new Error(
            `Failed to parse ffprobe JSON for ${filePath}: ${
              e instanceof Error ? e.message : String(e)
            }`
          )
        );
      }
    });
  });
}

async function normalizeClip(
  inputPath: string,
  outputPath: string,
  targetW: number,
  targetH: number,
  quality: QualityEncode
): Promise<void> {
  await runFfmpeg([
    "-i",
    inputPath,
    "-vf",
    `scale=${targetW}:${targetH}`,
    "-c:v",
    "libx264",
    "-crf",
    String(quality.crf),
    "-preset",
    quality.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    quality.audioBitrate,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function concatDemuxerCopy(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const escapeConcatPath = (p: string) =>
    p.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const listBody =
    inputPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
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

/**
 * Concatenate already-exported candidates in order →
 * prontos/{runId}/merged_{timestamp}.mp4
 *
 * Only status "exported". Normalizes to the largest resolution among inputs
 * when resolutions/codecs differ, using qualityPresets encode settings.
 */
export async function mergeCandidates(
  input: MergeCandidatesInput
): Promise<MergeCandidatesResult> {
  const t0 = Date.now();
  const quality = getQualityPreset(input.quality);
  if (!quality) {
    throw new Error(`Invalid quality: ${input.quality}. Use draft | hd | max`);
  }

  const ids = input.candidateIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("candidateIds must be a non-empty array of strings");
  }
  if (ids.some((id) => typeof id !== "string" || !id)) {
    throw new Error("candidateIds must be a non-empty array of strings");
  }

  const resolved: Array<{
    id: string;
    candidate: MarkedCandidate;
    vodId: string;
    filePath: string;
  }> = [];

  const invalidIds: string[] = [];

  for (const id of ids) {
    let found;
    try {
      found = await findMarkedCandidateById(id);
    } catch {
      invalidIds.push(id);
      continue;
    }
    if (found.candidate.status !== "exported") {
      invalidIds.push(id);
      continue;
    }
    const vodDir = path.join(getDataDir(), found.vodId);
    const rel =
      found.candidate.exportRelativePath ??
      null;
    if (!rel) {
      invalidIds.push(id);
      continue;
    }
    const filePath = path.join(vodDir, rel);
    try {
      await fs.access(filePath);
    } catch {
      invalidIds.push(id);
      continue;
    }
    resolved.push({
      id,
      candidate: found.candidate,
      vodId: found.vodId,
      filePath,
    });
  }

  if (invalidIds.length > 0) {
    throw new Error(
      `Invalid candidates (must exist, status "exported", and have export file): ${invalidIds.join(", ")}`
    );
  }

  const vodId = resolved[0].vodId;
  const mixedVod = resolved.filter((r) => r.vodId !== vodId).map((r) => r.id);
  if (mixedVod.length > 0) {
    throw new Error(
      `All candidates must belong to the same VOD. Mismatched: ${mixedVod.join(", ")}`
    );
  }

  const probes = await Promise.all(
    resolved.map(async (r) => ({
      ...r,
      probe: await probeMedia(r.filePath),
    }))
  );

  // Largest resolution = max (width * height); ties → first in request order
  let best = probes[0];
  for (const p of probes) {
    const area = p.probe.width * p.probe.height;
    const bestArea = best.probe.width * best.probe.height;
    if (area > bestArea) best = p;
  }
  const targetW = best.probe.width;
  const targetH = best.probe.height;

  const allSameRes = probes.every(
    (p) => p.probe.width === targetW && p.probe.height === targetH
  );

  // Decision: same resolution → skip normalize. Re-encode only when sizes differ
  // (target = largest w×h among inputs). quality CRF/audio/x264 apply on re-encode.
  const needsNormalize = !allSameRes;

  const vodDir = path.join(getDataDir(), vodId);
  const workDir = path.join(vodDir, "exports", `merge_${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  let concatInputs: string[];
  try {
    if (!needsNormalize) {
      concatInputs = probes.map((p) => p.filePath);
    } else {
      concatInputs = [];
      for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        const outPath = path.join(workDir, `norm_${i}_${p.id}.mp4`);
        await normalizeClip(
          p.filePath,
          outPath,
          targetW,
          targetH,
          quality
        );
        concatInputs.push(outPath);
      }
    }

    const { runId } = await getCurrentRun(vodId);
    const runDir = path.join(vodDir, "prontos", runId);
    await fs.mkdir(runDir, { recursive: true });
    const fileName = `merged_${Date.now()}.mp4`;
    const prontosPath = path.join(runDir, fileName);
    await concatDemuxerCopy(concatInputs, prontosPath);

    return {
      vodId,
      runId,
      candidateIds: ids,
      prontosPath,
      prontosRelativePath: `prontos/${runId}/${fileName}`,
      targetResolution: { w: targetW, h: targetH },
      normalized: needsNormalize,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
