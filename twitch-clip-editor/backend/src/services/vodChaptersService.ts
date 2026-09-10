import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";

export type ObsChapter = {
  timeSec: number;
  title: string;
};

export type ChaptersFile = {
  chapters: ObsChapter[];
  extractedAt: string;
  source: "ffprobe";
};

function runFfprobeJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start ffprobe: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffprobe exited with code ${code}: ${stderr.slice(-500)}`)
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Failed to parse ffprobe JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

function parseTimeSec(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if ([h, m, s].every((n) => Number.isFinite(n))) return h * 3600 + m * 60 + s;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function extractChaptersFromFile(
  sourcePath: string
): Promise<ObsChapter[]> {
  const raw = (await runFfprobeJson([
    "-show_chapters",
    "-v",
    "quiet",
    "-print_format",
    "json",
    sourcePath,
  ])) as { chapters?: Array<{ start_time?: unknown; tags?: { title?: string } }> };

  const chapters = raw.chapters ?? [];
  const out: ObsChapter[] = [];
  for (const ch of chapters) {
    const timeSec = parseTimeSec(ch.start_time);
    if (timeSec == null) continue;
    out.push({
      timeSec: Number(timeSec.toFixed(3)),
      title: ch.tags?.title?.trim() || "",
    });
  }
  out.sort((a, b) => a.timeSec - b.timeSec);
  return out;
}

function chaptersPath(vodId: string): string {
  return path.join(getDataDir(), vodId, "chapters.json");
}

export async function readChapters(vodId: string): Promise<ObsChapter[]> {
  try {
    const raw = await fs.readFile(chaptersPath(vodId), "utf-8");
    const parsed = JSON.parse(raw) as ChaptersFile;
    return parsed.chapters ?? [];
  } catch {
    return [];
  }
}

export async function extractAndStoreChapters(
  vodId: string
): Promise<ObsChapter[]> {
  const sourcePath = path.join(getDataDir(), vodId, "source.mp4");
  try {
    await fs.access(sourcePath);
  } catch {
    return [];
  }
  const chapters = await extractChaptersFromFile(sourcePath);
  const payload: ChaptersFile = {
    chapters,
    extractedAt: new Date().toISOString(),
    source: "ffprobe",
  };
  await fs.writeFile(chaptersPath(vodId), JSON.stringify(payload, null, 2), "utf-8");
  return chapters;
}
