import { getDb } from "../db";
import {
  findMarkedCandidateById,
  writeMarkedCandidates,
  type MarkedCandidate,
  type MarkedCandidateStatus,
} from "./markedCandidatesService";

export type ClipEditableKind = "candidate" | "clip_segment";

export type ClipEditableStatus = MarkedCandidateStatus;

/**
 * Shared shape for trim / transcribe / export — works for candidates and clip_segments.
 */
export type ClipEditable = {
  id: string;
  vodId: string;
  start: number;
  end: number;
  originalStart?: number;
  originalEnd?: number;
  status: ClipEditableStatus;
  previewRelativePath?: string;
  clipTranscriptRelativePath?: string;
  clipAssRelativePath?: string;
  clipSrtRelativePath?: string;
  exportRelativePath?: string;
  isManuallyEdited?: boolean;
  kind: ClipEditableKind;
};

type ClipSegmentRow = {
  id: string;
  vod_id: string;
  source_start: number;
  source_end: number;
  original_source_start: number | null;
  original_source_end: number | null;
  status: string | null;
  preview_relative_path: string | null;
  clip_transcript_relative_path: string | null;
  clip_ass_relative_path: string | null;
  clip_srt_relative_path: string | null;
  export_relative_path: string | null;
  is_manually_edited: number | null;
};

function candidateToEditable(c: MarkedCandidate): ClipEditable {
  return {
    id: c.id,
    vodId: c.vodId,
    start: c.start,
    end: c.end,
    originalStart: c.originalStart,
    originalEnd: c.originalEnd,
    status: c.status,
    previewRelativePath: c.previewRelativePath,
    clipTranscriptRelativePath: c.clipTranscriptRelativePath,
    clipAssRelativePath: c.clipAssRelativePath,
    clipSrtRelativePath: c.clipSrtRelativePath,
    exportRelativePath: c.exportRelativePath,
    isManuallyEdited: c.isManuallyEdited,
    kind: "candidate",
  };
}

function segmentRowToEditable(row: ClipSegmentRow): ClipEditable {
  const e: ClipEditable = {
    id: row.id,
    vodId: row.vod_id,
    start: row.source_start,
    end: row.source_end,
    status: (row.status as ClipEditableStatus) || "marked",
    kind: "clip_segment",
  };
  if (row.original_source_start != null)
    e.originalStart = row.original_source_start;
  if (row.original_source_end != null) e.originalEnd = row.original_source_end;
  if (row.preview_relative_path)
    e.previewRelativePath = row.preview_relative_path;
  if (row.clip_transcript_relative_path)
    e.clipTranscriptRelativePath = row.clip_transcript_relative_path;
  if (row.clip_ass_relative_path)
    e.clipAssRelativePath = row.clip_ass_relative_path;
  if (row.clip_srt_relative_path)
    e.clipSrtRelativePath = row.clip_srt_relative_path;
  if (row.export_relative_path) e.exportRelativePath = row.export_relative_path;
  if (row.is_manually_edited != null)
    e.isManuallyEdited = row.is_manually_edited === 1;
  return e;
}

/**
 * Resolve an id as either a marked candidate or a clip_segment.
 * Candidates are tried first (legacy ids), then clip_segments.
 */
export async function findClipEditableById(
  id: string
): Promise<ClipEditable> {
  try {
    const found = await findMarkedCandidateById(id);
    return candidateToEditable(found.candidate);
  } catch {
    // not a candidate — try clip_segments
  }

  const row = getDb()
    .prepare("SELECT * FROM clip_segments WHERE id = ?")
    .get(id) as ClipSegmentRow | undefined;
  if (!row) {
    throw new Error(`candidate not found: ${id}`);
  }
  return segmentRowToEditable(row);
}

/** Persist editable fields back to the owning table. */
export async function saveClipEditable(editable: ClipEditable): Promise<void> {
  if (editable.kind === "candidate") {
    const found = await findMarkedCandidateById(editable.id);
    const next: MarkedCandidate = {
      ...found.candidate,
      start: editable.start,
      end: editable.end,
      status: editable.status,
      originalStart: editable.originalStart,
      originalEnd: editable.originalEnd,
      previewRelativePath: editable.previewRelativePath,
      clipTranscriptRelativePath: editable.clipTranscriptRelativePath,
      clipAssRelativePath: editable.clipAssRelativePath,
      clipSrtRelativePath: editable.clipSrtRelativePath,
      exportRelativePath: editable.exportRelativePath,
      isManuallyEdited: editable.isManuallyEdited,
    };
    found.file.candidates[found.index] = next;
    await writeMarkedCandidates(found.file);
    return;
  }

  getDb()
    .prepare(
      `UPDATE clip_segments SET
        source_start = @source_start,
        source_end = @source_end,
        original_source_start = @original_source_start,
        original_source_end = @original_source_end,
        status = @status,
        preview_relative_path = @preview_relative_path,
        clip_transcript_relative_path = @clip_transcript_relative_path,
        clip_ass_relative_path = @clip_ass_relative_path,
        clip_srt_relative_path = @clip_srt_relative_path,
        export_relative_path = @export_relative_path,
        is_manually_edited = @is_manually_edited
       WHERE id = @id`
    )
    .run({
      id: editable.id,
      source_start: editable.start,
      source_end: editable.end,
      original_source_start: editable.originalStart ?? null,
      original_source_end: editable.originalEnd ?? null,
      status: editable.status,
      preview_relative_path: editable.previewRelativePath ?? null,
      clip_transcript_relative_path:
        editable.clipTranscriptRelativePath ?? null,
      clip_ass_relative_path: editable.clipAssRelativePath ?? null,
      clip_srt_relative_path: editable.clipSrtRelativePath ?? null,
      export_relative_path: editable.exportRelativePath ?? null,
      is_manually_edited:
        editable.isManuallyEdited == null
          ? null
          : editable.isManuallyEdited
            ? 1
            : 0,
    });
}
