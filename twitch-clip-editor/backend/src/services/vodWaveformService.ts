import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { WAVEFORM_BUCKET_COUNT } from "../config/vodNavigationDefaults";
import { getDataDir } from "./vodIngest";
import { probeMediaDurationSeconds } from "./mediaProbe";

export type WaveformFile = {
  bucketCount: number;
  durationSec: number;
  peaks: number[];
  generatedAtMs: number;
  elapsedMs: number;
};

function waveformPath(vodId: string): string {
  return path.join(getDataDir(), vodId, "waveform.json");
}

function extractPeaksFromPcm(
  pcm: Buffer,
  bucketCount: number
): { peaks: number[]; durationSec: number } {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount <= 0) {
    return { peaks: new Array(bucketCount).fill(0), durationSec: 0 };
  }
  const view = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.byteLength / 2)
  );
  const samplesPerBucket = Math.max(1, Math.floor(view.length / bucketCount));
  const peaks: number[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(view.length, start + samplesPerBucket);
    let max = 0;
    for (let i = start; i < end; i++) {
      const norm = Math.abs(view[i]) / 32768;
      if (norm > max) max = norm;
    }
    peaks.push(Number(max.toFixed(4)));
  }
  return { peaks, durationSec: view.length / 8000 };
}

async function decodeAudioPcm(sourcePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(
      "ffmpeg",
      [
        "-i",
        sourcePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg audio decode failed: ${stderr.slice(-500)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function getOrCreateWaveform(
  vodId: string
): Promise<WaveformFile & { cached: boolean }> {
  const wfPath = waveformPath(vodId);
  try {
    const raw = await fs.readFile(wfPath, "utf-8");
    const parsed = JSON.parse(raw) as WaveformFile;
    if (parsed.peaks?.length > 0) {
      return { ...parsed, cached: true };
    }
  } catch {
    // generate
  }

  const sourcePath = path.join(getDataDir(), vodId, "source.mp4");
  await fs.access(sourcePath);
  const t0 = Date.now();
  const probed = await probeMediaDurationSeconds(sourcePath);
  const pcm = await decodeAudioPcm(sourcePath);
  const { peaks } = extractPeaksFromPcm(pcm, WAVEFORM_BUCKET_COUNT);
  const durationSec = probed ?? peaks.length;
  const payload: WaveformFile = {
    bucketCount: WAVEFORM_BUCKET_COUNT,
    durationSec,
    peaks,
    generatedAtMs: Date.now(),
    elapsedMs: Date.now() - t0,
  };
  await fs.writeFile(wfPath, JSON.stringify(payload), "utf-8");
  return { ...payload, cached: false };
}
