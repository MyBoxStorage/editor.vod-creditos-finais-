/**
 * Apply image overlay with fade and export — validation helper.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { initDb, getDb } from "../src/db/index.js";
import { exportCandidate } from "../src/services/candidateExportService.js";

initDb();

const API = process.env.API_BASE ?? "http://localhost:3001";
const IMAGE_ID = process.argv[2] ?? "4a79d8b6-44f0-400d-8285-c01d31d78653";

const row = getDb()
  .prepare(
    "SELECT id FROM candidates WHERE vod_id = 'v2820282061' ORDER BY created_at DESC LIMIT 1"
  )
  .get() as { id: string } | undefined;

if (!row) {
  console.error("No candidate");
  process.exit(1);
}

const candidateId = row.id;

// Remove prior image overlays on this clip
const prior = getDb()
  .prepare(
    "SELECT id FROM clip_audio_instances WHERE clip_segment_id = ? AND type = 'image'"
  )
  .all(candidateId) as Array<{ id: string }>;
for (const inst of prior) {
  await fetch(`${API}/candidates/${candidateId}/effects/${inst.id}`, {
    method: "DELETE",
  });
}

const applyRes = await fetch(`${API}/candidates/${candidateId}/effects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    effectLibraryItemId: IMAGE_ID,
    sourceTrimStart: 0,
    sourceTrimEnd: 2,
    clipTimestamp: 0,
    positionX: 10,
    positionY: 10,
    positionWidth: 37,
    positionHeight: 18,
    fadeInSeconds: 0.4,
    fadeOutSeconds: 0.4,
  }),
});

if (!applyRes.ok) {
  console.error("apply failed", await applyRes.text());
  process.exit(1);
}

const t0 = Date.now();
const result = await exportCandidate(candidateId, {
  useSubtitles: false,
  subtitleRange: null,
  quality: "draft",
  speed: 1,
  preset: "vertical-split-9x16",
});
const exportMs = Date.now() - t0;

if (!result.prontosPath || !fs.existsSync(result.prontosPath)) {
  console.error("export missing", result);
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const samples = [0.2, 1.0, 1.7];
const frameStats: Array<{ t: number; mean: number; pngBytes: number }> = [];
for (const t of samples) {
  const pngPath = path.join(scriptDir, `frame-${t}.png`);
  spawnSync(
    "ffmpeg",
    ["-ss", String(t), "-i", result.prontosPath, "-frames:v", "1", "-y", pngPath],
    { stdio: "ignore" }
  );
  const out = spawnSync(
    "ffmpeg",
    [
      "-ss",
      String(t),
      "-i",
      result.prontosPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 }
  );
  const buf = out.stdout as Buffer;
  const pngBytes = fs.existsSync(pngPath) ? fs.statSync(pngPath).size : 0;
  if (!buf?.length) {
    frameStats.push({ t, mean: 0, pngBytes });
    continue;
  }
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  frameStats.push({ t, mean: sum / buf.length, pngBytes });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      candidateId,
      imageId: IMAGE_ID,
      exportPath: result.prontosPath,
      exportMs,
      frameMeanLuma: frameStats,
    },
    null,
    2
  )
);
