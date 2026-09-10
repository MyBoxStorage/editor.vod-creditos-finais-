import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { ensureVodRow } from "../db";
import { extractAndStoreChapters } from "./vodChaptersService";

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");

export type VodMeta = {
  id: string;
  title: string;
  duration: number | null;
  uploadDate: string | null;
  webpageUrl: string;
  extractor: string;
};

export type IngestResult = {
  vodId: string;
  status: "completed";
  meta: VodMeta;
  sourcePath: string;
};

function extractVodIdFromUrl(url: string): string | null {
  const match = url.match(/twitch\.tv\/videos\/(\d+)/i);
  return match?.[1] ?? null;
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start yt-dlp (is it installed and on PATH?): ${err.message}`
        )
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `yt-dlp exited with code ${code}: ${stderr.trim() || stdout.trim()}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}

async function fetchMetadata(url: string): Promise<VodMeta> {
  const raw = await runYtDlp(["--dump-json", "--no-download", url]);
  const json = JSON.parse(raw) as Record<string, unknown>;

  const id =
    (typeof json.id === "string" && json.id) ||
    (typeof json.id === "number" ? String(json.id) : null) ||
    extractVodIdFromUrl(url);

  if (!id) {
    throw new Error("Could not determine VOD id from URL or yt-dlp metadata");
  }

  return {
    id,
    title: typeof json.title === "string" ? json.title : "Untitled",
    duration: typeof json.duration === "number" ? json.duration : null,
    uploadDate:
      typeof json.upload_date === "string" ? json.upload_date : null,
    webpageUrl:
      typeof json.webpage_url === "string" ? json.webpage_url : url,
    extractor: typeof json.extractor === "string" ? json.extractor : "unknown",
  };
}

async function downloadVod(url: string, outputPath: string): Promise<void> {
  // -o writes to the exact output path; merge to mp4 when needed
  await runYtDlp([
    "--no-playlist",
    "-f",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "-o",
    outputPath,
    url,
  ]);
}

/**
 * Downloads a Twitch VOD and writes source.mp4 + meta.json under data/{vodId}/.
 */
export async function ingestVod(url: string): Promise<IngestResult> {
  if (!url || typeof url !== "string") {
    throw new Error("url is required");
  }

  const meta = await fetchMetadata(url);
  const vodId = meta.id;
  const vodDir = path.join(DATA_DIR, vodId);
  const sourcePath = path.join(vodDir, "source.mp4");
  const metaPath = path.join(vodDir, "meta.json");

  await fs.mkdir(vodDir, { recursive: true });

  await downloadVod(url, sourcePath);

  // TODO: chat replay (sprint 2)

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  ensureVodRow(vodId, {
    title: meta.title,
    duration: meta.duration,
    uploadDate: meta.uploadDate,
    webpageUrl: meta.webpageUrl,
    extractor: meta.extractor,
  });

  await extractAndStoreChapters(vodId).catch(() => undefined);

  return {
    vodId,
    status: "completed",
    meta,
    sourcePath,
  };
}

export function getDataDir(): string {
  return DATA_DIR;
}
