import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { getCurrentRun } from "./pipelineRun";

/**
 * Copies a finished export into data/{vodId}/prontos/{runId}/ with a sequential name:
 *   {NNN}_{vodId}_{start}s-{end}s.mp4
 *   {NNN}_{vodId}_{start}s-{end}s_comGancho.mp4  (when hasHook)
 *
 * runId comes from current_run.json (written when candidates are generated).
 * Sequence numbers restart at 001 per runId folder.
 * Re-exporting the same start/end (+ same hook flag) overwrites the existing sequential slot.
 */
export async function publishToProntos(options: {
  vodId: string;
  start: number;
  end: number;
  sourceFinalPath: string;
  hasHook?: boolean;
}): Promise<{ prontosPath: string; fileName: string; runId: string }> {
  const { runId } = await getCurrentRun(options.vodId);
  const runDir = path.join(getDataDir(), options.vodId, "prontos", runId);
  await fs.mkdir(runDir, { recursive: true });

  const startSec = Math.round(options.start);
  const endSec = Math.round(options.end);
  const hookSuffix = options.hasHook ? "_comGancho" : "";
  const rangeSuffix = `_${options.vodId}_${startSec}s-${endSec}s${hookSuffix}.mp4`;

  const entries = await fs.readdir(runDir);
  const mp4Entries = entries.filter((name) => name.toLowerCase().endsWith(".mp4"));
  const existing = mp4Entries.find((name) => name.endsWith(rangeSuffix));

  let fileName: string;
  if (existing) {
    fileName = existing;
  } else {
    const usedNums = mp4Entries
      .map((name) => {
        const m = name.match(/^(\d+)_/);
        return m ? Number(m[1]) : null;
      })
      .filter((n): n is number => n != null);
    const next = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
    fileName = `${String(next).padStart(3, "0")}${rangeSuffix}`;
  }

  const prontosPath = path.join(runDir, fileName);
  await fs.copyFile(options.sourceFinalPath, prontosPath);
  return { prontosPath, fileName, runId };
}
