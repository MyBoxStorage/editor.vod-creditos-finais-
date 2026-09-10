import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { ensureVodRow, getDb } from "../db";
import { getDataDir } from "./vodIngest";
import { copyEffectInstancesToClip } from "./effectsLibraryService";
import { assertSegmentDurationAllowed } from "./segmentDurationPolicy";
import { trimPreview } from "./trimPreviewService";

export const MIN_CLIP_SEGMENT_SEC = 0.5;

export type ClipSegmentSourceType =
  | "vod-range"
  | "candidate"
  | "reusable-library-item";

export type ClipSegmentRole = "normal" | "hook";

export type ClipSegmentStatus =
  | "marked"
  | "trimmed"
  | "transcribed"
  | "exported";

export type ClipSegment = {
  id: string;
  sourceType: ClipSegmentSourceType;
  vodId: string;
  candidateId: string | null;
  sourceStart: number;
  sourceEnd: number;
  role: ClipSegmentRole;
  zoomKeyframes: unknown | null;
  colorPreset: string | null;
  speedRamp: unknown | null;
  isReusable: boolean;
  reusableName: string | null;
  tags: string[] | null;
  createdAt: string;
  status: ClipSegmentStatus;
  originalSourceStart: number | null;
  originalSourceEnd: number | null;
  previewRelativePath: string | null;
  clipTranscriptRelativePath: string | null;
  clipAssRelativePath: string | null;
  clipSrtRelativePath: string | null;
  exportRelativePath: string | null;
  isManuallyEdited: boolean | null;
  presetApplicationsJson: unknown | null;
};

type ClipSegmentRow = {
  id: string;
  source_type: string;
  vod_id: string;
  candidate_id: string | null;
  source_start: number;
  source_end: number;
  role: string;
  zoom_keyframes: string | null;
  color_preset: string | null;
  speed_ramp: string | null;
  is_reusable: number;
  reusable_name: string | null;
  tags: string | null;
  created_at: string;
  status: string | null;
  original_source_start: number | null;
  original_source_end: number | null;
  preview_relative_path: string | null;
  clip_transcript_relative_path: string | null;
  clip_ass_relative_path: string | null;
  clip_srt_relative_path: string | null;
  export_relative_path: string | null;
  is_manually_edited: number | null;
  preset_applications_json: string | null;
};

function parseJsonField(raw: string | null): unknown | null {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseTags(raw: string | null): string[] | null {
  const parsed = parseJsonField(raw);
  if (!Array.isArray(parsed)) return null;
  const tags = parsed.filter((t): t is string => typeof t === "string");
  return tags.length > 0 ? tags : parsed.length === 0 ? [] : null;
}

function rowToSegment(row: ClipSegmentRow): ClipSegment {
  return {
    id: row.id,
    sourceType: row.source_type as ClipSegmentSourceType,
    vodId: row.vod_id,
    candidateId: row.candidate_id,
    sourceStart: row.source_start,
    sourceEnd: row.source_end,
    role: (row.role as ClipSegmentRole) || "normal",
    zoomKeyframes: parseJsonField(row.zoom_keyframes),
    colorPreset: row.color_preset,
    speedRamp: parseJsonField(row.speed_ramp),
    isReusable: row.is_reusable === 1,
    reusableName: row.reusable_name,
    tags: parseTags(row.tags ?? null),
    createdAt: row.created_at,
    status: (row.status as ClipSegmentStatus) || "marked",
    originalSourceStart: row.original_source_start,
    originalSourceEnd: row.original_source_end,
    previewRelativePath: row.preview_relative_path,
    clipTranscriptRelativePath: row.clip_transcript_relative_path,
    clipAssRelativePath: row.clip_ass_relative_path,
    clipSrtRelativePath: row.clip_srt_relative_path,
    exportRelativePath: row.export_relative_path,
    isManuallyEdited:
      row.is_manually_edited == null ? null : row.is_manually_edited === 1,
    presetApplicationsJson: parseJsonField(row.preset_applications_json),
  };
}

export type CreateClipSegmentInput = {
  vodId: string;
  start: number;
  end: number;
  candidateId?: string | null;
  role?: ClipSegmentRole;
};

/** Always creates a NEW clip_segment (never reuses by range). */
export function createClipSegment(input: CreateClipSegmentInput): ClipSegment {
  if (!(typeof input.start === "number") || !(typeof input.end === "number")) {
    throw new Error("start and end must be numbers");
  }
  if (!(input.end > input.start)) {
    throw new Error("end must be greater than start");
  }
  assertSegmentDurationAllowed(input.start, input.end);

  const role: ClipSegmentRole =
    input.role === "hook" || input.role === "normal" ? input.role : "normal";
  const candidateId =
    typeof input.candidateId === "string" && input.candidateId
      ? input.candidateId
      : null;
  const sourceType: ClipSegmentSourceType = candidateId
    ? "candidate"
    : "vod-range";

  if (candidateId) {
    const exists = getDb()
      .prepare("SELECT id FROM candidates WHERE id = ?")
      .get(candidateId) as { id: string } | undefined;
    if (!exists) {
      throw new Error(`candidate not found: ${candidateId}`);
    }
  }

  ensureVodRow(input.vodId);
  const id = randomUUID();
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO clip_segments (
        id, source_type, vod_id, candidate_id, source_start, source_end, role,
        zoom_keyframes, color_preset, speed_ramp, is_reusable, reusable_name,
        created_at, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, NULL, 0, NULL,
        ?, 'marked'
      )`
    )
    .run(
      id,
      sourceType,
      input.vodId,
      candidateId,
      input.start,
      input.end,
      role,
      now
    );

  if (candidateId) {
    copyEffectInstancesToClip(candidateId, id);
  }

  return getClipSegmentById(id);
}

export function getClipSegmentById(id: string): ClipSegment {
  const row = getDb()
    .prepare("SELECT * FROM clip_segments WHERE id = ?")
    .get(id) as ClipSegmentRow | undefined;
  if (!row) {
    throw new Error(`clip_segment not found: ${id}`);
  }
  return rowToSegment(row);
}

export function listClipSegmentsForVod(vodId: string): ClipSegment[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM clip_segments WHERE vod_id = ? ORDER BY source_start ASC`
    )
    .all(vodId) as ClipSegmentRow[];
  return rows.map(rowToSegment);
}

export type UpdateClipSegmentPatch = {
  sourceStart?: number;
  sourceEnd?: number;
  originalSourceStart?: number | null;
  originalSourceEnd?: number | null;
  status?: ClipSegmentStatus;
  previewRelativePath?: string | null;
  clipTranscriptRelativePath?: string | null;
  clipAssRelativePath?: string | null;
  clipSrtRelativePath?: string | null;
  exportRelativePath?: string | null;
  isManuallyEdited?: boolean | null;
  zoomKeyframes?: unknown | null;
  colorPreset?: string | null;
  speedRamp?: unknown | null;
  isReusable?: boolean;
  reusableName?: string | null;
  tags?: string[] | null;
  role?: ClipSegmentRole;
  presetApplicationsJson?: unknown | null;
};

export function updateClipSegment(
  id: string,
  patch: UpdateClipSegmentPatch
): ClipSegment {
  const current = getClipSegmentById(id);
  const next: ClipSegment = {
    ...current,
    sourceStart:
      patch.sourceStart !== undefined ? patch.sourceStart : current.sourceStart,
    sourceEnd:
      patch.sourceEnd !== undefined ? patch.sourceEnd : current.sourceEnd,
    originalSourceStart:
      patch.originalSourceStart !== undefined
        ? patch.originalSourceStart
        : current.originalSourceStart,
    originalSourceEnd:
      patch.originalSourceEnd !== undefined
        ? patch.originalSourceEnd
        : current.originalSourceEnd,
    status: patch.status !== undefined ? patch.status : current.status,
    previewRelativePath:
      patch.previewRelativePath !== undefined
        ? patch.previewRelativePath
        : current.previewRelativePath,
    clipTranscriptRelativePath:
      patch.clipTranscriptRelativePath !== undefined
        ? patch.clipTranscriptRelativePath
        : current.clipTranscriptRelativePath,
    clipAssRelativePath:
      patch.clipAssRelativePath !== undefined
        ? patch.clipAssRelativePath
        : current.clipAssRelativePath,
    clipSrtRelativePath:
      patch.clipSrtRelativePath !== undefined
        ? patch.clipSrtRelativePath
        : current.clipSrtRelativePath,
    exportRelativePath:
      patch.exportRelativePath !== undefined
        ? patch.exportRelativePath
        : current.exportRelativePath,
    isManuallyEdited:
      patch.isManuallyEdited !== undefined
        ? patch.isManuallyEdited
        : current.isManuallyEdited,
    zoomKeyframes:
      patch.zoomKeyframes !== undefined
        ? patch.zoomKeyframes
        : current.zoomKeyframes,
    colorPreset:
      patch.colorPreset !== undefined ? patch.colorPreset : current.colorPreset,
    speedRamp:
      patch.speedRamp !== undefined ? patch.speedRamp : current.speedRamp,
    isReusable:
      patch.isReusable !== undefined ? patch.isReusable : current.isReusable,
    reusableName:
      patch.reusableName !== undefined
        ? patch.reusableName
        : current.reusableName,
    tags: patch.tags !== undefined ? patch.tags : current.tags,
    role: patch.role !== undefined ? patch.role : current.role,
    presetApplicationsJson:
      patch.presetApplicationsJson !== undefined
        ? patch.presetApplicationsJson
        : current.presetApplicationsJson,
  };

  getDb()
    .prepare(
      `UPDATE clip_segments SET
        source_start = @source_start,
        source_end = @source_end,
        original_source_start = @original_source_start,
        original_source_end = @original_source_end,
        role = @role,
        zoom_keyframes = @zoom_keyframes,
        color_preset = @color_preset,
        speed_ramp = @speed_ramp,
        is_reusable = @is_reusable,
        reusable_name = @reusable_name,
        tags = @tags,
        status = @status,
        preview_relative_path = @preview_relative_path,
        clip_transcript_relative_path = @clip_transcript_relative_path,
        clip_ass_relative_path = @clip_ass_relative_path,
        clip_srt_relative_path = @clip_srt_relative_path,
        export_relative_path = @export_relative_path,
        is_manually_edited = @is_manually_edited,
        preset_applications_json = @preset_applications_json
       WHERE id = @id`
    )
    .run({
      id,
      source_start: next.sourceStart,
      source_end: next.sourceEnd,
      original_source_start: next.originalSourceStart,
      original_source_end: next.originalSourceEnd,
      role: next.role,
      zoom_keyframes:
        next.zoomKeyframes == null
          ? null
          : JSON.stringify(next.zoomKeyframes),
      color_preset: next.colorPreset,
      speed_ramp:
        next.speedRamp == null ? null : JSON.stringify(next.speedRamp),
      is_reusable: next.isReusable ? 1 : 0,
      reusable_name: next.reusableName,
      tags: next.tags == null ? null : JSON.stringify(next.tags),
      status: next.status,
      preview_relative_path: next.previewRelativePath,
      clip_transcript_relative_path: next.clipTranscriptRelativePath,
      clip_ass_relative_path: next.clipAssRelativePath,
      clip_srt_relative_path: next.clipSrtRelativePath,
      export_relative_path: next.exportRelativePath,
      is_manually_edited:
        next.isManuallyEdited == null ? null : next.isManuallyEdited ? 1 : 0,
      preset_applications_json:
        next.presetApplicationsJson == null
          ? null
          : JSON.stringify(next.presetApplicationsJson),
    });

  return getClipSegmentById(id);
}

export function toggleClipSegmentReusable(
  id: string,
  isReusable: boolean,
  reusableName?: string,
  tags?: string[]
): ClipSegment {
  const patch: UpdateClipSegmentPatch = { isReusable };
  if (reusableName !== undefined) {
    patch.reusableName = reusableName;
  } else if (!isReusable) {
    patch.reusableName = null;
  }
  if (tags !== undefined) {
    patch.tags = tags;
  } else if (!isReusable) {
    patch.tags = null;
  }
  return updateClipSegment(id, patch);
}

/**
 * Clone a reusable clip_segment into a fresh editable copy (new id).
 * Copies raw range + preview file only — no edits / reusable flags.
 */
export async function cloneClipSegmentForReuse(
  sourceId: string
): Promise<ClipSegment> {
  const source = getClipSegmentById(sourceId);
  if (!source.isReusable) {
    throw new Error(
      `clip_segment ${sourceId} is not marked reusable — toggle isReusable first`
    );
  }

  const clone = createClipSegment({
    vodId: source.vodId,
    start: source.sourceStart,
    end: source.sourceEnd,
    role: source.role,
    candidateId: null,
  });

  // Mark source type as library pull; keep range only
  getDb()
    .prepare(
      `UPDATE clip_segments SET source_type = 'reusable-library-item' WHERE id = ?`
    )
    .run(clone.id);

  let previewRelativePath: string | null = null;
  if (source.previewRelativePath) {
    const vodDir = path.join(getDataDir(), source.vodId);
    const srcPreview = path.join(vodDir, source.previewRelativePath);
    try {
      await fs.access(srcPreview);
      const previewsDir = path.join(vodDir, "previews");
      await fs.mkdir(previewsDir, { recursive: true });
      const destRel = `previews/${clone.id}.mp4`;
      await fs.copyFile(srcPreview, path.join(vodDir, destRel));
      previewRelativePath = destRel;
    } catch {
      // no preview to copy — clone stays without preview
    }
  }

  if (previewRelativePath) {
    return updateClipSegment(clone.id, {
      previewRelativePath,
      status: "marked",
    });
  }

  return getClipSegmentById(clone.id);
}

export function countCompositionsUsingSegment(clipSegmentId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT composition_id) AS c
       FROM composition_segments WHERE clip_segment_id = ?`
    )
    .get(clipSegmentId) as { c: number };
  return row?.c ?? 0;
}

export function saveClipSegmentPresetApplications(
  id: string,
  presetApplications: unknown
): ClipSegment {
  if (!Array.isArray(presetApplications)) {
    throw new Error("presetApplications must be an array");
  }
  return updateClipSegment(id, {
    presetApplicationsJson: presetApplications,
  });
}

/**
 * Trim trecho original (contract §20.6) — updates source interval and regenerates preview.
 */
export async function trimClipSegmentInterval(
  id: string,
  sourceStart: number,
  sourceEnd: number
): Promise<ClipSegment> {
  if (!(sourceEnd > sourceStart)) {
    throw new Error("sourceEnd must be greater than sourceStart");
  }
  if (sourceEnd - sourceStart < MIN_CLIP_SEGMENT_SEC) {
    throw new Error(
      `Trecho deve ter pelo menos ${MIN_CLIP_SEGMENT_SEC}s após o aparo`
    );
  }
  assertSegmentDurationAllowed(sourceStart, sourceEnd);
  updateClipSegment(id, {
    sourceStart,
    sourceEnd,
    status: "trimmed",
  });
  await trimPreview(id, sourceStart, sourceEnd);
  return getClipSegmentById(id);
}
