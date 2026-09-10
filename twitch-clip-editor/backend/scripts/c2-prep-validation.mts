/**
 * C2 prep: regen divergent previews + validate ensurePreviewForInterval.
 */
import fs from "fs/promises";
import path from "path";
import { initDb } from "../src/db/index.js";
import { trimPreview } from "../src/services/trimPreviewService.js";
import { getDataDir } from "../src/services/vodIngest.js";
import { getClipSegmentById } from "../src/services/clipSegmentsService.js";
import { findMarkedCandidateById } from "../src/services/markedCandidatesService.js";
import { probeMediaDurationSeconds } from "../src/services/mediaProbe.js";
import { exportCandidate } from "../src/services/candidateExportService.js";
import {
  clearPreviewDurationCache,
  ensurePreviewForInterval,
} from "../src/services/previewIntegrity.js";
import { PREVIEW_DURATION_TOLERANCE_SEC } from "../src/services/clipDuration.js";

initDb();

const VOD = "v2820282061";
const REGEN_IDS = [
  {
    id: "8751ebf7-4dc4-48a5-b6bd-ffc266f9898c",
    kind: "clip_segment" as const,
  },
  {
    id: "de6ddea8-8368-446f-a9f5-407a0217a7b9",
    kind: "candidate" as const,
  },
  {
    id: "3c8e4c22-5448-4011-b9d3-04bed71c6fcf",
    kind: "candidate" as const,
  },
];
const TEST_EXPORT_ID = "5a38accd-25ca-44bc-b0eb-1cd61dfe36a8";

async function intervalFor(id: string, kind: "clip_segment" | "candidate") {
  if (kind === "clip_segment") {
    const s = getClipSegmentById(id);
    return { start: s.sourceStart, end: s.sourceEnd };
  }
  const { candidate } = await findMarkedCandidateById(id);
  return { start: candidate.start, end: candidate.end };
}

async function main() {
  console.log("=== 1a: regenerate divergent previews ===");
  const regenReport: unknown[] = [];
  for (const row of REGEN_IDS) {
    const { start, end } = await intervalFor(row.id, row.kind);
    await trimPreview(row.id, start, end);
    const previewPath = path.join(
      getDataDir(),
      VOD,
      "previews",
      `${row.id}.mp4`
    );
    const probed = await probeMediaDurationSeconds(previewPath);
    const marked = end - start;
    const ok =
      probed != null &&
      Math.abs(probed - marked) <= PREVIEW_DURATION_TOLERANCE_SEC;
    regenReport.push({
      id: row.id,
      marked,
      probed,
      delta: probed != null ? probed - marked : null,
      ok,
    });
  }
  console.log(JSON.stringify(regenReport, null, 2));

  console.log("=== validation 2: stale preview auto-regen on export ===");
  const testPreview = path.join(
    getDataDir(),
    VOD,
    "previews",
    `${TEST_EXPORT_ID}.mp4`
  );
  const backup = `${testPreview}.bak`;
  const staleDonor = path.join(
    getDataDir(),
    VOD,
    "previews",
    "8751ebf7-4dc4-48a5-b6bd-ffc266f9898c.mp4"
  );
  await fs.copyFile(testPreview, backup);
  await fs.copyFile(staleDonor, testPreview);
  clearPreviewDurationCache();
  const beforeStale = await probeMediaDurationSeconds(testPreview);
  const t0 = Date.now();
  await exportCandidate(TEST_EXPORT_ID, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
    presetApplications: [],
  });
  const exportMs = Date.now() - t0;
  const afterExport = await probeMediaDurationSeconds(testPreview);
  await fs.copyFile(backup, testPreview);
  await fs.unlink(backup);
  clearPreviewDurationCache();
  const expectedMarked = 2;
  const regenOk =
    afterExport != null &&
    Math.abs(afterExport - expectedMarked) <= PREVIEW_DURATION_TOLERANCE_SEC;
  console.log(
    JSON.stringify(
      {
        staleDonorDuration: beforeStale,
        afterExportDuration: afterExport,
        expectedMarked,
        autoRegenOnExport: regenOk,
        exportMsWithStalePreview: exportMs,
      },
      null,
      2
    )
  );

  console.log("=== validation 3: integrity check overhead ===");
  clearPreviewDurationCache();
  const tCold = Date.now();
  await ensurePreviewForInterval(TEST_EXPORT_ID);
  const ensureColdMs = Date.now() - tCold;

  const tWarm = Date.now();
  await ensurePreviewForInterval(TEST_EXPORT_ID);
  const ensureWarmMs = Date.now() - tWarm;

  clearPreviewDurationCache();
  const tExport1 = Date.now();
  await exportCandidate(TEST_EXPORT_ID, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
    presetApplications: [],
  });
  const exportColdCacheMs = Date.now() - tExport1;

  const tExport2 = Date.now();
  await exportCandidate(TEST_EXPORT_ID, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
    presetApplications: [],
  });
  const exportWarmCacheMs = Date.now() - tExport2;

  console.log(
    JSON.stringify(
      {
        ensurePreviewColdMs: ensureColdMs,
        ensurePreviewWarmMs: ensureWarmMs,
        exportFirstCallMs: exportColdCacheMs,
        exportSecondCallMs: exportWarmCacheMs,
        integrityOverheadEstimateMs: ensureWarmMs,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
