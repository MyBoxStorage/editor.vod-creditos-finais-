import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { PeakCandidate } from "./chatPeakDetector";
import type { Transcript } from "../services/transcribeService";

/**
 * Weaker heuristic than chat peaks.
 * Combines:
 * 1) non-silent coverage from ffmpeg silencedetect (inverted silence)
 * 2) transcript excitement (!!!, ALL CAPS words)
 */
export async function detectFallbackPeaks(
  sourceMp4Path: string,
  transcript: Transcript | null,
  options?: {
    windowSeconds?: number;
    topK?: number;
    vodDurationSeconds?: number;
  }
): Promise<PeakCandidate[]> {
  const windowSeconds = options?.windowSeconds ?? 15;
  const topK = options?.topK ?? 15;

  const duration =
    options?.vodDurationSeconds ??
    (await probeDurationSeconds(sourceMp4Path)) ??
    inferDurationFromTranscript(transcript) ??
    60;

  const windowCount = Math.max(1, Math.ceil(duration / windowSeconds));
  const scores = new Array<number>(windowCount).fill(0);

  // Heuristic (weaker than chat): inverted silence → activity score per window
  const silentRanges = await detectSilentRanges(sourceMp4Path);
  for (let i = 0; i < windowCount; i++) {
    const start = i * windowSeconds;
    const end = Math.min((i + 1) * windowSeconds, duration);
    const silent = overlapSeconds(start, end, silentRanges);
    const windowLen = Math.max(0.001, end - start);
    const activeRatio = 1 - silent / windowLen;
    scores[i] += activeRatio;
  }

  if (transcript) {
    for (const seg of transcript.segments) {
      const idx = Math.min(
        windowCount - 1,
        Math.max(0, Math.floor(seg.start / windowSeconds))
      );
      const text = seg.text || "";
      const bangs = (text.match(/!/g) || []).length;
      const capsWords = (text.match(/\b[A-ZÁÉÍÓÚÃÕÂÊÔÀÜ]{3,}\b/g) || [])
        .length;
      scores[idx] += bangs * 0.15 + capsWords * 0.25 + 0.05;
    }
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((acc, v) => acc + (v - avg) ** 2, 0) / scores.length;
  const sd = Math.sqrt(variance);

  const candidates: PeakCandidate[] = scores.map((raw, i) => {
    const z = sd === 0 ? 0 : (raw - avg) / sd;
    return {
      start: i * windowSeconds,
      end: Math.min((i + 1) * windowSeconds, duration),
      score: z,
      sampleMessages: [],
    };
  });

  return candidates.sort((a, b) => b.score - a.score).slice(0, topK);
}

type Range = { start: number; end: number };

function overlapSeconds(start: number, end: number, ranges: Range[]): number {
  let total = 0;
  for (const r of ranges) {
    const s = Math.max(start, r.start);
    const e = Math.min(end, r.end);
    if (e > s) total += e - s;
  }
  return total;
}

function inferDurationFromTranscript(
  transcript: Transcript | null
): number | null {
  if (!transcript || transcript.segments.length === 0) return null;
  return Math.max(...transcript.segments.map((s) => s.end));
}

function probeDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("close", () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
    child.on("error", () => resolve(null));
  });
}

function detectSilentRanges(filePath: string): Promise<Range[]> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      [
        "-i",
        filePath,
        "-af",
        "silencedetect=noise=-30dB:d=0.5",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    child.on("close", () => {
      const ranges: Range[] = [];
      let currentStart: number | null = null;
      const lines = stderr.split(/\r?\n/);
      for (const line of lines) {
        const s = line.match(/silence_start:\s*([\d.]+)/);
        if (s) {
          currentStart = parseFloat(s[1]);
          continue;
        }
        const e = line.match(/silence_end:\s*([\d.]+)/);
        if (e && currentStart != null) {
          ranges.push({ start: currentStart, end: parseFloat(e[1]) });
          currentStart = null;
        }
      }

      resolve(ranges);
    });

    child.on("error", () => resolve([]));
  });
}

export async function loadTranscriptIfExists(
  transcriptPath: string
): Promise<Transcript | null> {
  try {
    const raw = await fs.readFile(transcriptPath, "utf-8");
    return JSON.parse(raw) as Transcript;
  } catch {
    return null;
  }
}

export function chatLogPath(vodDir: string): string {
  return path.join(vodDir, "chat.json");
}
