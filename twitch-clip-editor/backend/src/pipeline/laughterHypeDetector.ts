import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { PeakCandidate } from "./chatPeakDetector";
import { detectAudioEnergyPeaks } from "./audioEnergyDetector";

export type LaughterEvent = {
  start: number;
  end: number;
  confidence: number;
};

type LaughterFile = {
  events: LaughterEvent[];
};

/**
 * Combined laughter + energy peak detector.
 * Overlapping windows (both signals) get the highest scores.
 */
export async function detectLaughterHypePeaks(
  vodId: string,
  sourceMp4Path: string,
  vodDir: string,
  options?: {
    topK?: number;
    vodDurationSeconds?: number;
    energyWindowSeconds?: number;
  }
): Promise<PeakCandidate[]> {
  const topK = options?.topK ?? 15;
  const laughterPath = path.join(vodDir, "laughter.json");

  const [laughterEvents, energyPeaks] = await Promise.all([
    runLaughterDetect(sourceMp4Path, laughterPath),
    detectAudioEnergyPeaks(sourceMp4Path, {
      windowSeconds: options?.energyWindowSeconds ?? 2,
      topK: 50, // keep more for merge, trim later
      vodDurationSeconds: options?.vodDurationSeconds,
    }),
  ]);

  // Map energy peaks by window index for overlap checks
  const merged = new Map<string, PeakCandidate>();

  const keyFor = (start: number, end: number) =>
    `${start.toFixed(2)}:${end.toFixed(2)}`;

  for (const e of energyPeaks) {
    merged.set(keyFor(e.start, e.end), {
      start: e.start,
      end: e.end,
      score: e.score,
      sampleMessages: [`[energy z=${e.score.toFixed(2)}]`],
      source: "energy",
    });
  }

  for (const laugh of laughterEvents) {
    const overlapping = energyPeaks.filter(
      (e) => rangesOverlap(laugh.start, laugh.end, e.start, e.end)
    );

    if (overlapping.length > 0) {
      // Prefer the strongest overlapping energy window; boost as "both"
      const best = overlapping.reduce((a, b) => (a.score > b.score ? a : b));
      const start = Math.min(laugh.start, best.start);
      const end = Math.max(laugh.end, best.end);
      const score = best.score + Math.max(0.5, laugh.confidence) + 1.5; // both >> either alone
      const k = keyFor(best.start, best.end);
      merged.set(k, {
        start,
        end,
        score,
        sampleMessages: [
          `[both laughter+energy conf=${laugh.confidence.toFixed(2)} z=${best.score.toFixed(2)}]`,
        ],
        source: "both",
      });
    } else {
      const score = Math.max(0.5, laugh.confidence);
      const k = keyFor(laugh.start, laugh.end);
      merged.set(k, {
        start: laugh.start,
        end: laugh.end,
        score,
        sampleMessages: [
          `[laughter conf=${laugh.confidence.toFixed(2)}]`,
        ],
        source: "laughter",
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function getPythonCommand(): string {
  return process.env.PYTHON_PATH || process.env.PYTHON || "python";
}

function runLaughterDetect(
  sourceMp4Path: string,
  outputJsonPath: string
): Promise<LaughterEvent[]> {
  const scriptPath = path.resolve(
    __dirname,
    "..",
    "..",
    "scripts",
    "laughter_detect.py"
  );

  return new Promise((resolve, reject) => {
    const child = spawn(
      getPythonCommand(),
      [scriptPath, sourceMp4Path, outputJsonPath],
      {
        windowsHide: true,
        shell: process.platform === "win32",
        env: { ...process.env },
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start laughter_detect.py (${getPythonCommand()}): ${err.message}`
        )
      );
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `laughter_detect.py exited with code ${code}: ${stderr.trim() || stdout.trim()}`
          )
        );
        return;
      }
      try {
        const raw = await fs.readFile(outputJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as LaughterFile;
        resolve(Array.isArray(parsed.events) ? parsed.events : []);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to read laughter.json: ${message}`));
      }
    });
  });
}
