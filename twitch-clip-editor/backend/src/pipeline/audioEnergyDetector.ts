import { spawn } from "child_process";
import { mean, stdDev, type PeakCandidate } from "./chatPeakDetector";

export type EnergyPeakOptions = {
  windowSeconds?: number; // default 2s
  topK?: number;
  vodDurationSeconds?: number;
};

/**
 * RMS energy peaks via ffmpeg astats (windowed) → z-score (same stats as chat peaks).
 */
export async function detectAudioEnergyPeaks(
  sourceMp4Path: string,
  options?: EnergyPeakOptions
): Promise<PeakCandidate[]> {
  const windowSeconds = options?.windowSeconds ?? 2;
  const topK = options?.topK ?? 15;

  const duration =
    options?.vodDurationSeconds ??
    (await probeDurationSeconds(sourceMp4Path)) ??
    0;

  if (!(duration > 0)) {
    throw new Error(`Could not determine duration for ${sourceMp4Path}`);
  }

  const rmsByWindow = await extractWindowRms(sourceMp4Path, windowSeconds);
  const windowCount = Math.max(
    1,
    Math.ceil(duration / windowSeconds),
    rmsByWindow.length
  );

  // Pad/truncate to windowCount
  const values = new Array<number>(windowCount).fill(0);
  for (let i = 0; i < Math.min(windowCount, rmsByWindow.length); i++) {
    values[i] = rmsByWindow[i];
  }

  const avg = mean(values);
  const sd = stdDev(values, avg);

  const candidates: PeakCandidate[] = values.map((rms, i) => {
    const z = sd === 0 ? 0 : (rms - avg) / sd;
    return {
      start: i * windowSeconds,
      end: Math.min((i + 1) * windowSeconds, duration),
      score: z,
      sampleMessages: [],
      source: "energy" as const,
    };
  });

  return candidates
    .filter((c) => c.score > 0 || values.length <= topK)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
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

/**
 * Uses ffmpeg:
 *  aresample=16000 + asetnsamples (windowSeconds * 16000) + astats reset per window
 *  → lavfi.astats.Overall.RMS_level (dB; higher = louder)
 */
function extractWindowRms(
  filePath: string,
  windowSeconds: number
): Promise<number[]> {
  const samplesPerWindow = Math.max(1, Math.round(windowSeconds * 16000));

  return new Promise((resolve, reject) => {
    const filter = [
      "aresample=16000",
      `asetnsamples=n=${samplesPerWindow}:p=0`,
      "astats=metadata=1:reset=1",
      "ametadata=print:key=lavfi.astats.Overall.RMS_level",
    ].join(",");

    const child = spawn(
      "ffmpeg",
      ["-i", filePath, "-vn", "-af", filter, "-f", "null", "-"],
      { windowsHide: true, shell: process.platform === "win32" }
    );

    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0 && !stderr.includes("RMS_level")) {
        reject(
          new Error(
            `ffmpeg energy analysis failed (code ${code}): ${stderr.slice(-1500)}`
          )
        );
        return;
      }

      const levels: number[] = [];
      const re = /lavfi\.astats\.Overall\.RMS_level\s*=\s*([-\d.]+|nan)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stderr)) !== null) {
        const v = parseFloat(m[1]);
        // Treat -inf/nan silence as a very low floor so z-score still works
        levels.push(Number.isFinite(v) ? v : -100);
      }

      if (levels.length === 0) {
        reject(
          new Error(
            `No RMS_level metadata found in ffmpeg output for ${filePath}`
          )
        );
        return;
      }

      resolve(levels);
    });
  });
}
