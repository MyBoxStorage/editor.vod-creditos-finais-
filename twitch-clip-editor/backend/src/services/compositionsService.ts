import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { ensureVodRow, getDb } from "../db";
import { getDataDir } from "./vodIngest";
import { getCurrentRun } from "./pipelineRun";
import { runFfmpeg } from "../pipeline/clipRenderer";
import {
  getClipSegmentById,
  type ClipSegment,
} from "./clipSegmentsService";
import {
  getQualityPreset,
  type QualityEncode,
  type QualityId,
} from "./qualityPresets";

export type CompositionStatus = "draft" | "exported";

export type Composition = {
  id: string;
  vodId: string | null;
  name: string | null;
  status: CompositionStatus;
  createdAt: string;
  subtitleSettingsJson: unknown | null;
  joinSettingsJson: unknown | null;
  colorSettingsJson: unknown | null;
  openingSettingsJson: unknown | null;
  closingSettingsJson: unknown | null;
};

export type CompositionWithSegments = Composition & {
  segments: Array<{
    orderIndex: number;
    clipSegment: ClipSegment;
  }>;
};

type CompositionRow = {
  id: string;
  vod_id: string | null;
  name: string | null;
  status: string;
  created_at: string;
  subtitle_settings_json?: string | null;
  join_settings_json?: string | null;
  color_settings_json?: string | null;
  opening_settings_json?: string | null;
  closing_settings_json?: string | null;
};

type CompositionSegmentRow = {
  id: string;
  composition_id: string;
  clip_segment_id: string;
  order_index: number;
};

function parseCompositionJson(raw: string | null | undefined): unknown | null {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToComposition(row: CompositionRow): Composition {
  return {
    id: row.id,
    vodId: row.vod_id,
    name: row.name,
    status: (row.status as CompositionStatus) || "draft",
    createdAt: row.created_at,
    subtitleSettingsJson: parseCompositionJson(row.subtitle_settings_json),
    joinSettingsJson: parseCompositionJson(row.join_settings_json),
    colorSettingsJson: parseCompositionJson(row.color_settings_json),
    openingSettingsJson: parseCompositionJson(row.opening_settings_json),
    closingSettingsJson: parseCompositionJson(row.closing_settings_json),
  };
}

/**
 * Hooks always first (order 0..n-1), then remaining ids in given order.
 * Multiple hooks stay at the front in the order they appeared among hooks.
 */
export function orderIdsWithHooksFirst(
  clipSegmentIds: string[]
): string[] {
  const segments = clipSegmentIds.map((id) => getClipSegmentById(id));
  const hooks = segments.filter((s) => s.role === "hook").map((s) => s.id);
  const normals = segments.filter((s) => s.role !== "hook").map((s) => s.id);
  return [...hooks, ...normals];
}

function replaceCompositionSegments(
  compositionId: string,
  orderedIds: string[]
): void {
  const database = getDb();
  const tx = database.transaction(() => {
    database
      .prepare("DELETE FROM composition_segments WHERE composition_id = ?")
      .run(compositionId);
    const insert = database.prepare(
      `INSERT INTO composition_segments (id, composition_id, clip_segment_id, order_index)
       VALUES (?, ?, ?, ?)`
    );
    orderedIds.forEach((clipSegmentId, orderIndex) => {
      insert.run(randomUUID(), compositionId, clipSegmentId, orderIndex);
    });
  });
  tx();
}

export function getCompositionById(id: string): Composition {
  const row = getDb()
    .prepare("SELECT * FROM compositions WHERE id = ?")
    .get(id) as CompositionRow | undefined;
  if (!row) {
    throw new Error(`composition not found: ${id}`);
  }
  return rowToComposition(row);
}

export function getCompositionWithSegments(
  id: string
): CompositionWithSegments {
  const composition = getCompositionById(id);
  const rows = getDb()
    .prepare(
      `SELECT * FROM composition_segments
       WHERE composition_id = ?
       ORDER BY order_index ASC`
    )
    .all(id) as CompositionSegmentRow[];

  return {
    ...composition,
    segments: rows.map((r) => ({
      orderIndex: r.order_index,
      clipSegment: getClipSegmentById(r.clip_segment_id),
    })),
  };
}

export type CreateCompositionInput = {
  vodId?: string | null;
  name?: string | null;
  clipSegmentIds: string[];
};

export function createComposition(
  input: CreateCompositionInput
): CompositionWithSegments {
  const ids = input.clipSegmentIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("clipSegmentIds must be a non-empty array");
  }
  if (ids.some((id) => typeof id !== "string" || !id)) {
    throw new Error("clipSegmentIds must be a non-empty array of strings");
  }

  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error("clipSegmentIds must not contain duplicates");
  }

  const segments = ids.map((id) => getClipSegmentById(id));
  const vodIds = [...new Set(segments.map((s) => s.vodId))];
  if (vodIds.length > 1) {
    throw new Error(
      `All clip_segments must belong to the same VOD. Found: ${vodIds.join(", ")}`
    );
  }

  const vodId =
    typeof input.vodId === "string" && input.vodId
      ? input.vodId
      : vodIds[0];
  if (vodId !== vodIds[0]) {
    throw new Error(
      `vodId ${vodId} does not match clip_segments VOD ${vodIds[0]}`
    );
  }

  ensureVodRow(vodId);
  const ordered = orderIdsWithHooksFirst(ids);
  const compositionId = randomUUID();
  const now = new Date().toISOString();
  const name =
    typeof input.name === "string" && input.name ? input.name : null;

  getDb()
    .prepare(
      `INSERT INTO compositions (id, vod_id, name, status, created_at)
       VALUES (?, ?, ?, 'draft', ?)`
    )
    .run(compositionId, vodId, name, now);

  replaceCompositionSegments(compositionId, ordered);
  return getCompositionWithSegments(compositionId);
}

export function addSegmentToComposition(
  compositionId: string,
  clipSegmentId: string
): CompositionWithSegments {
  const composition = getCompositionById(compositionId);
  const segment = getClipSegmentById(clipSegmentId);

  if (composition.vodId && segment.vodId !== composition.vodId) {
    throw new Error(
      `clip_segment VOD ${segment.vodId} does not match composition VOD ${composition.vodId}`
    );
  }

  const current = getCompositionWithSegments(compositionId);
  if (current.segments.some((s) => s.clipSegment.id === clipSegmentId)) {
    throw new Error(
      `clip_segment ${clipSegmentId} is already in this composition`
    );
  }

  const ids = [
    ...current.segments.map((s) => s.clipSegment.id),
    clipSegmentId,
  ];
  replaceCompositionSegments(compositionId, orderIdsWithHooksFirst(ids));
  return getCompositionWithSegments(compositionId);
}

export function removeSegmentFromComposition(
  compositionId: string,
  clipSegmentId: string
): CompositionWithSegments {
  getCompositionById(compositionId);
  const current = getCompositionWithSegments(compositionId);
  const nextIds = current.segments
    .map((s) => s.clipSegment.id)
    .filter((id) => id !== clipSegmentId);
  if (nextIds.length === current.segments.length) {
    throw new Error(
      `clip_segment ${clipSegmentId} is not in composition ${compositionId}`
    );
  }
  if (nextIds.length === 0) {
    throw new Error(
      "Cannot remove the last clip_segment from a composition (would leave it empty)"
    );
  }
  replaceCompositionSegments(compositionId, orderIdsWithHooksFirst(nextIds));
  return getCompositionWithSegments(compositionId);
}

/**
 * Persist a full reorder. Hooks are forced back to the front automatically
 * (orderIdsWithHooksFirst) so a hook can never sit outside position 0.
 */
export function reorderCompositionSegments(
  compositionId: string,
  clipSegmentIds: string[]
): CompositionWithSegments {
  const current = getCompositionWithSegments(compositionId);
  const currentIds = current.segments.map((s) => s.clipSegment.id).sort();
  const incoming = [...clipSegmentIds].sort();
  if (
    currentIds.length !== incoming.length ||
    currentIds.some((id, i) => id !== incoming[i])
  ) {
    throw new Error(
      "reorder must include exactly the same clipSegmentIds already in the composition"
    );
  }
  replaceCompositionSegments(
    compositionId,
    orderIdsWithHooksFirst(clipSegmentIds)
  );
  return getCompositionWithSegments(compositionId);
}

export function listCompositionsForVod(vodId: string): Composition[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM compositions WHERE vod_id = ? ORDER BY created_at DESC`
    )
    .all(vodId) as CompositionRow[];
  return rows.map(rowToComposition);
}

export function updateCompositionSubtitleSettings(
  compositionId: string,
  subtitleSettings: unknown
): Composition {
  getCompositionById(compositionId);
  getDb()
    .prepare(
      `UPDATE compositions SET subtitle_settings_json = ? WHERE id = ?`
    )
    .run(JSON.stringify(subtitleSettings), compositionId);
  return getCompositionById(compositionId);
}

export function updateCompositionJoinSettings(
  compositionId: string,
  joinSettings: unknown
): Composition {
  getCompositionById(compositionId);
  getDb()
    .prepare(`UPDATE compositions SET join_settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(joinSettings), compositionId);
  return getCompositionById(compositionId);
}

export function updateCompositionColorSettings(
  compositionId: string,
  colorSettings: unknown
): Composition {
  getCompositionById(compositionId);
  getDb()
    .prepare(`UPDATE compositions SET color_settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(colorSettings), compositionId);
  return getCompositionById(compositionId);
}

export function updateCompositionOpeningSettings(
  compositionId: string,
  openingSettings: unknown
): Composition {
  getCompositionById(compositionId);
  getDb()
    .prepare(`UPDATE compositions SET opening_settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(openingSettings), compositionId);
  return getCompositionById(compositionId);
}

export function updateCompositionClosingSettings(
  compositionId: string,
  closingSettings: unknown
): Composition {
  getCompositionById(compositionId);
  getDb()
    .prepare(`UPDATE compositions SET closing_settings_json = ? WHERE id = ?`)
    .run(JSON.stringify(closingSettings), compositionId);
  return getCompositionById(compositionId);
}

type ProbeInfo = {
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
};

function probeMedia(filePath: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height,codec_name,codec_type",
        "-of",
        "json",
        filePath,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e) => {
      reject(new Error(`Failed to start ffprobe: ${e.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffprobe failed for ${filePath}: ${err.slice(-500)}`)
        );
        return;
      }
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
          }>;
        };
        const streams = parsed.streams ?? [];
        const video = streams.find((s) => s.codec_type === "video");
        const audio = streams.find((s) => s.codec_type === "audio");
        if (
          !video ||
          typeof video.width !== "number" ||
          typeof video.height !== "number" ||
          !video.codec_name
        ) {
          reject(new Error(`No video stream in ${filePath}`));
          return;
        }
        resolve({
          width: video.width,
          height: video.height,
          videoCodec: video.codec_name,
          audioCodec: audio?.codec_name ?? null,
        });
      } catch (e) {
        reject(
          new Error(
            `Failed to parse ffprobe JSON for ${filePath}: ${
              e instanceof Error ? e.message : String(e)
            }`
          )
        );
      }
    });
  });
}

async function normalizeClip(
  inputPath: string,
  outputPath: string,
  targetW: number,
  targetH: number,
  quality: QualityEncode
): Promise<void> {
  await runFfmpeg([
    "-i",
    inputPath,
    "-vf",
    `scale=${targetW}:${targetH}`,
    "-c:v",
    "libx264",
    "-crf",
    String(quality.crf),
    "-preset",
    quality.x264Preset,
    "-c:a",
    "aac",
    "-b:a",
    quality.audioBitrate,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function concatDemuxerCopy(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`;
  const escapeConcatPath = (p: string) =>
    p.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const listBody =
    inputPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
  await fs.writeFile(listPath, listBody, "utf-8");
  try {
    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }
}

export type ExportCompositionResult = {
  composition: CompositionWithSegments;
  runId: string;
  prontosPath: string;
  prontosRelativePath: string;
  targetResolution: { w: number; h: number };
  normalized: boolean;
  elapsedMs: number;
};

/**
 * Concat already-exported clip_segment finals in composition order.
 * Does NOT cascade individual exports — missing exports return a clear error.
 */
export async function exportComposition(
  compositionId: string,
  qualityId: QualityId
): Promise<ExportCompositionResult> {
  const t0 = Date.now();
  const quality = getQualityPreset(qualityId);
  if (!quality) {
    throw new Error(`Invalid quality: ${qualityId}. Use draft | hd | max`);
  }

  const composition = getCompositionWithSegments(compositionId);
  if (composition.segments.length === 0) {
    throw new Error("composition has no segments to export");
  }

  const notExported = composition.segments
    .filter((s) => s.clipSegment.status !== "exported")
    .map((s) => s.clipSegment.id);
  if (notExported.length > 0) {
    throw new Error(
      `All clip_segments must be exported individually first (POST /candidates/:id/export). Not exported: ${notExported.join(", ")}`
    );
  }

  const vodId = composition.vodId ?? composition.segments[0].clipSegment.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const resolved: Array<{ id: string; filePath: string }> = [];
  for (const entry of composition.segments) {
    const seg = entry.clipSegment;
    const rel = seg.exportRelativePath;
    if (!rel) {
      throw new Error(
        `clip_segment ${seg.id} is status exported but missing exportRelativePath — re-export it first`
      );
    }
    const filePath = path.join(vodDir, rel);
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(
        `Export file missing for clip_segment ${seg.id} at ${rel} — re-export it first`
      );
    }
    resolved.push({ id: seg.id, filePath });
  }

  const probes = await Promise.all(
    resolved.map(async (r) => ({
      ...r,
      probe: await probeMedia(r.filePath),
    }))
  );

  let best = probes[0];
  for (const p of probes) {
    const area = p.probe.width * p.probe.height;
    const bestArea = best.probe.width * best.probe.height;
    if (area > bestArea) best = p;
  }
  const targetW = best.probe.width;
  const targetH = best.probe.height;
  const needsNormalize = !probes.every(
    (p) => p.probe.width === targetW && p.probe.height === targetH
  );

  const workDir = path.join(
    vodDir,
    "exports",
    `composition_${compositionId}_${Date.now()}`
  );
  await fs.mkdir(workDir, { recursive: true });

  try {
    let concatInputs: string[];
    if (!needsNormalize) {
      concatInputs = probes.map((p) => p.filePath);
    } else {
      concatInputs = [];
      for (let i = 0; i < probes.length; i++) {
        const p = probes[i];
        const outPath = path.join(workDir, `norm_${i}_${p.id}.mp4`);
        await normalizeClip(p.filePath, outPath, targetW, targetH, quality);
        concatInputs.push(outPath);
      }
    }

    const { runId } = await getCurrentRun(vodId);
    const runDir = path.join(vodDir, "prontos", runId);
    await fs.mkdir(runDir, { recursive: true });
    const fileName = `composition_${compositionId}_final.mp4`;
    const prontosPath = path.join(runDir, fileName);
    await concatDemuxerCopy(concatInputs, prontosPath);

    getDb()
      .prepare(`UPDATE compositions SET status = 'exported' WHERE id = ?`)
      .run(compositionId);

    return {
      composition: getCompositionWithSegments(compositionId),
      runId,
      prontosPath,
      prontosRelativePath: `prontos/${runId}/${fileName}`,
      targetResolution: { w: targetW, h: targetH },
      normalized: needsNormalize,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
