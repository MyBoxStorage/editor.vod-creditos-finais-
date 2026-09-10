import fs from "fs/promises";
import path from "path";
import {
  NAV_THUMBNAIL_INTERVAL_SEC,
  NAV_THUMBNAIL_WIDTH,
} from "../config/vodNavigationDefaults";
import { runFfmpeg } from "../pipeline/clipRenderer";
import { probeMediaDurationSeconds } from "./mediaProbe";
import { getDataDir } from "./vodIngest";

export type NavThumbnailEntry = {
  index: number;
  timeSec: number;
  relativePath: string;
};

export type NavThumbnailManifest = {
  intervalSec: number;
  width: number;
  durationSec: number;
  thumbnails: NavThumbnailEntry[];
  generatedAtMs: number;
  elapsedMs: number;
};

function manifestPath(vodId: string): string {
  return path.join(getDataDir(), vodId, "nav_thumbs", "manifest.json");
}

function thumbsDir(vodId: string): string {
  return path.join(getDataDir(), vodId, "nav_thumbs");
}

export async function getOrCreateNavThumbnailStrip(
  vodId: string
): Promise<NavThumbnailManifest & { cached: boolean }> {
  const mPath = manifestPath(vodId);
  try {
    const raw = await fs.readFile(mPath, "utf-8");
    const parsed = JSON.parse(raw) as NavThumbnailManifest;
    if (parsed.thumbnails?.length > 0) {
      return { ...parsed, cached: true };
    }
  } catch {
    // generate
  }

  const sourcePath = path.join(getDataDir(), vodId, "source.mp4");
  await fs.access(sourcePath);
  const t0 = Date.now();
  const durationSec = (await probeMediaDurationSeconds(sourcePath)) ?? 0;
  const dir = thumbsDir(vodId);
  await fs.mkdir(dir, { recursive: true });

  const fps = 1 / NAV_THUMBNAIL_INTERVAL_SEC;
  const pattern = path.join(dir, "%05d.jpg");
  await runFfmpeg([
    "-i",
    sourcePath,
    "-vf",
    `fps=${fps},scale=${NAV_THUMBNAIL_WIDTH}:-1`,
    "-q:v",
    "4",
    pattern,
  ]);

  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  const thumbnails: NavThumbnailEntry[] = files.map((fileName, index) => ({
    index,
    timeSec: Number((index * NAV_THUMBNAIL_INTERVAL_SEC).toFixed(3)),
    relativePath: `nav_thumbs/${fileName}`,
  }));

  const payload: NavThumbnailManifest = {
    intervalSec: NAV_THUMBNAIL_INTERVAL_SEC,
    width: NAV_THUMBNAIL_WIDTH,
    durationSec,
    thumbnails,
    generatedAtMs: Date.now(),
    elapsedMs: Date.now() - t0,
  };
  await fs.writeFile(mPath, JSON.stringify(payload), "utf-8");
  return { ...payload, cached: false };
}
