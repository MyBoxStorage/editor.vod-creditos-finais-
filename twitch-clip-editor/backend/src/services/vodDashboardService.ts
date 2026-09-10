import fs from "fs/promises";
import path from "path";
import { getDataDir, type VodMeta } from "./vodIngest";

export type VodListItem = {
  vodId: string;
  title: string;
  duration: number | null;
  uploadDate: string | null;
  webpageUrl?: string;
};

export type ProntosClip = {
  fileName: string;
  urlPath: string;
  sizeBytes: number;
};

export type ProntosRun = {
  runId: string;
  method: string | null;
  /** Parsed from runId when possible, else folder mtime ISO. */
  labelDate: string | null;
  clipCount: number;
  clips: ProntosClip[];
};

function parseRunId(runId: string): {
  method: string | null;
  labelDate: string | null;
} {
  // run_2026-07-22_15h03_semantic
  const m = runId.match(
    /^run_(\d{4}-\d{2}-\d{2})_(\d{2})h(\d{2})_([a-zA-Z0-9+-]+)$/
  );
  if (!m) return { method: null, labelDate: null };
  return {
    labelDate: `${m[1]} ${m[2]}:${m[3]}`,
    method: m[4],
  };
}

export async function listVods(): Promise<VodListItem[]> {
  const dataDir = getDataDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dataDir);
  } catch {
    return [];
  }

  const items: VodListItem[] = [];
  for (const name of entries) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const metaPath = path.join(dataDir, name, "meta.json");
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw) as Partial<VodMeta>;
      items.push({
        vodId: meta.id || name,
        title: meta.title || name,
        duration: typeof meta.duration === "number" ? meta.duration : null,
        uploadDate: meta.uploadDate ?? null,
        webpageUrl: meta.webpageUrl,
      });
    } catch {
      // skip dirs without readable meta
    }
  }

  return items.sort((a, b) => a.vodId.localeCompare(b.vodId));
}

export async function listProntosRuns(vodId: string): Promise<ProntosRun[]> {
  const prontosDir = path.join(getDataDir(), vodId, "prontos");
  let entries: string[];
  try {
    entries = await fs.readdir(prontosDir);
  } catch {
    return [];
  }

  const runs: ProntosRun[] = [];
  for (const name of entries) {
    const full = path.join(prontosDir, name);
    let st;
    try {
      st = await fs.stat(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const files = await fs.readdir(full);
    const clips: ProntosClip[] = [];
    for (const fileName of files) {
      if (!fileName.toLowerCase().endsWith(".mp4")) continue;
      const fp = path.join(full, fileName);
      const fst = await fs.stat(fp);
      clips.push({
        fileName,
        urlPath: `/media/${vodId}/prontos/${name}/${fileName}`,
        sizeBytes: fst.size,
      });
    }
    clips.sort((a, b) => a.fileName.localeCompare(b.fileName));

    const parsed = parseRunId(name);
    runs.push({
      runId: name,
      method: parsed.method,
      labelDate: parsed.labelDate ?? st.mtime.toISOString(),
      clipCount: clips.length,
      clips,
    });
  }

  return runs.sort((a, b) => b.runId.localeCompare(a.runId));
}
