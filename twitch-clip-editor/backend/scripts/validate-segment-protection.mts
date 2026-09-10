/**
 * Validates segment duration policy + trim-preview failure safety (API level).
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../src/db/index.ts";
import { getDataDir } from "../src/services/vodIngest.ts";

const VOD = "v2820282061";
const API = "http://localhost:3001";

async function api(
  method: string,
  route: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
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
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe failed"))
    );
  });
}

function readCandidateRange(id: string): { start: number; end: number } | null {
  const row = getDb()
    .prepare("SELECT start, end FROM candidates WHERE id = ?")
    .get(id) as { start: number; end: number } | undefined;
  return row ?? null;
}

const results: Record<string, unknown> = {};

// 3. Block 15 min creation
const block15 = await api("POST", `/vod/${VOD}/ensure-candidate`, {
  start: 100,
  end: 100 + 15 * 60,
  reason: "validation 15min block",
  origin: "validation",
});
results.block15min = {
  status: block15.status,
  error: block15.json.error,
  ok: block15.status === 400 && String(block15.json.error).includes("10 minutos"),
};

// 4. Allow 4 min creation (warning is UI-only)
const warn4 = await api("POST", `/vod/${VOD}/ensure-candidate`, {
  start: 50,
  end: 50 + 4 * 60,
  reason: "validation 4min warn",
  origin: "validation",
});
const warn4Id = String(warn4.json.candidateId ?? "");
results.create4min = {
  status: warn4.status,
  candidateId: warn4Id.slice(0, 8),
  ok: warn4.status === 200,
};

// Item 13: ~45s segment, trim -3s, export, ffprobe
const item13Create = await api("POST", `/vod/${VOD}/ensure-candidate`, {
  start: 800,
  end: 845,
  reason: "item13 validation ~45s",
  origin: "validation",
});
const item13Id = String(item13Create.json.candidateId ?? "");
await api("POST", `/candidates/${item13Id}/trim-preview`, { start: 800, end: 845 });
const trim3 = await api("POST", `/candidates/${item13Id}/trim-preview`, {
  start: 800,
  end: 842,
});
const expectedDur = 42;
const exportRes = await api("POST", `/candidates/${item13Id}/export`, {
  useSubtitles: false,
  subtitleRange: null,
  quality: "draft",
  speed: 1,
  preset: "vertical-split-9x16",
});
const exportPath = String(
  (exportRes.json as { prontosPath?: string }).prontosPath ??
    (exportRes.json as { exportPath?: string }).exportPath ??
    ""
);
let ffprobeDur: number | null = null;
if (exportPath) {
  try {
    ffprobeDur = await probeDuration(exportPath);
  } catch {
    ffprobeDur = null;
  }
}
results.item13 = {
  createStatus: item13Create.status,
  trimStatus: trim3.status,
  screenDuration: expectedDur,
  exportStatus: exportRes.status,
  ffprobeDur,
  ok:
    trim3.status === 200 &&
    trim3.json.end === 842 &&
    ffprobeDur != null &&
    Math.abs(ffprobeDur - expectedDur) <= 1 / 30 + 0.05,
};

// 5. Trim failure preserves DB interval
const failCand = await api("POST", `/vod/${VOD}/ensure-candidate`, {
  start: 900,
  end: 915,
  reason: "trim failure validation",
  origin: "validation",
});
const failId = String(failCand.json.candidateId ?? "");
await api("POST", `/candidates/${failId}/trim-preview`, { start: 900, end: 915 });
const before = readCandidateRange(failId);
const vodDir = path.join(getDataDir(), VOD);
const sourcePath = path.join(vodDir, "source.mp4");
const backupPath = path.join(vodDir, "source.mp4.validate-bak");
let moved = false;
try {
  await fs.rename(sourcePath, backupPath);
  moved = true;
  const failTrim = await api("POST", `/candidates/${failId}/trim-preview`, {
    start: 900,
    end: 910,
  });
  const after = readCandidateRange(failId);
  results.trimFailurePreservesDb = {
    before,
    after,
    failStatus: failTrim.status,
    ok:
      failTrim.status >= 400 &&
      before != null &&
      after != null &&
      before.start === after.start &&
      before.end === after.end,
  };
} finally {
  if (moved) {
    await fs.rename(backupPath, sourcePath).catch(() => undefined);
  }
}

// Block trim above 10 min
const blockTrim = await api("POST", `/candidates/${item13Id}/trim-preview`, {
  start: 0,
  end: 700,
});
results.blockTrim10min = {
  status: blockTrim.status,
  error: blockTrim.json.error,
  ok: blockTrim.status === 400,
};

console.log(JSON.stringify(results, null, 2));
