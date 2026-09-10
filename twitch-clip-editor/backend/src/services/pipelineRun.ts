import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";

export type PipelineRunMethod = "semantic" | "acoustic" | "chat" | "fallback";

export type CurrentRun = {
  runId: string;
  method: PipelineRunMethod;
  createdAt: string;
};

/**
 * Human-readable run id, e.g. run_2026-07-22_18h40_semantic
 */
export function formatRunId(
  method: PipelineRunMethod,
  date: Date = new Date()
): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `run_${y}-${mo}-${d}_${h}h${mi}_${method}`;
}

export async function beginPipelineRun(
  vodId: string,
  method: PipelineRunMethod
): Promise<CurrentRun> {
  const run: CurrentRun = {
    runId: formatRunId(method),
    method,
    createdAt: new Date().toISOString(),
  };
  const filePath = path.join(getDataDir(), vodId, "current_run.json");
  await fs.writeFile(filePath, JSON.stringify(run, null, 2), "utf-8");
  return run;
}

export async function getCurrentRun(vodId: string): Promise<CurrentRun> {
  const filePath = path.join(getDataDir(), vodId, "current_run.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as CurrentRun;
    if (!parsed?.runId || typeof parsed.runId !== "string") {
      throw new Error("invalid current_run.json");
    }
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No active pipeline run for vodId=${vodId}. Run POST /vod/${vodId}/candidates first. (${message})`
    );
  }
}
