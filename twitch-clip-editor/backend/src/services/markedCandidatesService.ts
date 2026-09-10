import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./vodIngest";
import { ensureVodRow, getDb, getDbPath } from "../db";
import {
  assertSegmentDurationAllowed,
  SEGMENT_DURATION_MAX_SEC,
} from "./segmentDurationPolicy";
import { rankHighlights, type Highlight } from "./claudeHighlightRanker";
import type { PeakCandidate } from "../pipeline/chatPeakDetector";

export type MarkedCandidateStatus =
  | "marked"
  | "trimmed"
  | "transcribed"
  | "exported";

/** Persisted after ranking — no ffmpeg/Whisper/export yet. */
export type MarkedCandidate = {
  id: string;
  vodId: string;
  start: number;
  end: number;
  /** First suggested start before any trim (set on first trim-preview). */
  originalStart?: number;
  /** First suggested end before any trim (set on first trim-preview). */
  originalEnd?: number;
  score: number;
  reason: string;
  origin: string;
  status: MarkedCandidateStatus;
  createdAt: string;
  /** Relative path under data/{vodId}/ when a preview exists. */
  previewRelativePath?: string;
  /** Relative path to isolated clip transcript JSON. */
  clipTranscriptRelativePath?: string;
  /** Relative path to isolated .ass captions. */
  clipAssRelativePath?: string;
  /** Relative path to isolated .srt captions. */
  clipSrtRelativePath?: string;
  /** Relative path under data/{vodId}/ to prontos export. */
  exportRelativePath?: string;
  /** True after POST /candidates/:id/save-transcript. */
  isManuallyEdited?: boolean;
};

export type MarkedCandidatesFile = {
  vodId: string;
  candidates: MarkedCandidate[];
  markedAt: string;
};

type CandidateRow = {
  id: string;
  vod_id: string;
  start: number;
  end: number;
  original_start: number | null;
  original_end: number | null;
  score: number;
  reason: string;
  origin: string;
  status: string;
  created_at: string;
  preview_relative_path: string | null;
  clip_transcript_relative_path: string | null;
  clip_ass_relative_path: string | null;
  clip_srt_relative_path: string | null;
  export_relative_path: string | null;
  is_manually_edited: number | null;
};

function matchPeak(
  highlight: Highlight,
  peaks: PeakCandidate[]
): PeakCandidate | null {
  let best: PeakCandidate | null = null;
  let bestOverlap = 0;
  for (const p of peaks) {
    const s = Math.max(highlight.start, p.start);
    const e = Math.min(highlight.end, p.end);
    const ov = e - s;
    if (ov > bestOverlap) {
      bestOverlap = ov;
      best = p;
    }
  }
  return bestOverlap > 0 ? best : null;
}

/** Legacy path helper (JSON no longer written; kept for API markedPath shape). */
export function markedCandidatesPath(vodId: string): string {
  return path.join(getDataDir(), vodId, "marked_candidates.json");
}

function rowToCandidate(row: CandidateRow): MarkedCandidate {
  const c: MarkedCandidate = {
    id: row.id,
    vodId: row.vod_id,
    start: row.start,
    end: row.end,
    score: row.score,
    reason: row.reason,
    origin: row.origin,
    status: row.status as MarkedCandidateStatus,
    createdAt: row.created_at,
  };
  if (row.original_start != null) c.originalStart = row.original_start;
  if (row.original_end != null) c.originalEnd = row.original_end;
  if (row.preview_relative_path)
    c.previewRelativePath = row.preview_relative_path;
  if (row.clip_transcript_relative_path)
    c.clipTranscriptRelativePath = row.clip_transcript_relative_path;
  if (row.clip_ass_relative_path)
    c.clipAssRelativePath = row.clip_ass_relative_path;
  if (row.clip_srt_relative_path)
    c.clipSrtRelativePath = row.clip_srt_relative_path;
  if (row.export_relative_path)
    c.exportRelativePath = row.export_relative_path;
  if (row.is_manually_edited != null)
    c.isManuallyEdited = row.is_manually_edited === 1;
  return c;
}

function listCandidateRows(vodId: string): CandidateRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM candidates WHERE vod_id = ? ORDER BY created_at ASC, start ASC`
    )
    .all(vodId) as CandidateRow[];
}

function upsertCandidate(c: MarkedCandidate): void {
  ensureVodRow(c.vodId);
  getDb()
    .prepare(
      `INSERT INTO candidates (
        id, vod_id, start, "end", original_start, original_end, score, reason,
        origin, status, created_at, preview_relative_path,
        clip_transcript_relative_path, clip_ass_relative_path,
        clip_srt_relative_path, export_relative_path, is_manually_edited
      ) VALUES (
        @id, @vod_id, @start, @end, @original_start, @original_end, @score, @reason,
        @origin, @status, @created_at, @preview_relative_path,
        @clip_transcript_relative_path, @clip_ass_relative_path,
        @clip_srt_relative_path, @export_relative_path, @is_manually_edited
      )
      ON CONFLICT(id) DO UPDATE SET
        vod_id = excluded.vod_id,
        start = excluded.start,
        "end" = excluded."end",
        original_start = excluded.original_start,
        original_end = excluded.original_end,
        score = excluded.score,
        reason = excluded.reason,
        origin = excluded.origin,
        status = excluded.status,
        created_at = excluded.created_at,
        preview_relative_path = excluded.preview_relative_path,
        clip_transcript_relative_path = excluded.clip_transcript_relative_path,
        clip_ass_relative_path = excluded.clip_ass_relative_path,
        clip_srt_relative_path = excluded.clip_srt_relative_path,
        export_relative_path = excluded.export_relative_path,
        is_manually_edited = excluded.is_manually_edited`
    )
    .run({
      id: c.id,
      vod_id: c.vodId,
      start: c.start,
      end: c.end,
      original_start: c.originalStart ?? null,
      original_end: c.originalEnd ?? null,
      score: c.score,
      reason: c.reason,
      origin: c.origin,
      status: c.status,
      created_at: c.createdAt,
      preview_relative_path: c.previewRelativePath ?? null,
      clip_transcript_relative_path: c.clipTranscriptRelativePath ?? null,
      clip_ass_relative_path: c.clipAssRelativePath ?? null,
      clip_srt_relative_path: c.clipSrtRelativePath ?? null,
      export_relative_path: c.exportRelativePath ?? null,
      is_manually_edited:
        c.isManuallyEdited == null ? null : c.isManuallyEdited ? 1 : 0,
    });
}

/**
 * Checkpoint-style "mark": run Claude ranking on candidates.json, persist refined
 * cuts to SQLite candidates. Does not call ffmpeg, Whisper, or export.
 */
export async function markCandidates(vodId: string): Promise<{
  vodId: string;
  candidates: MarkedCandidate[];
  markedPath: string;
  highlightsPath: string;
}> {
  const vodDir = path.join(getDataDir(), vodId);
  const peaksPath = path.join(vodDir, "candidates.json");

  let peaks: PeakCandidate[] = [];
  try {
    const raw = await fs.readFile(peaksPath, "utf-8");
    const parsed = JSON.parse(raw) as { candidates?: PeakCandidate[] };
    peaks = parsed.candidates ?? [];
  } catch {
    throw new Error(
      `candidates.json not found for vodId=${vodId}. Run POST /vod/${vodId}/candidates first.`
    );
  }

  const ranked = await rankHighlights(vodId);
  const now = new Date().toISOString();

  const candidates: MarkedCandidate[] = ranked.highlights
    .filter((h) => h.end - h.start <= SEGMENT_DURATION_MAX_SEC)
    .map((h) => {
    const peak = matchPeak(h, peaks);
    return {
      id: randomUUID(),
      vodId,
      start: h.start,
      end: h.end,
      score: peak?.score ?? 0,
      reason: h.reason || h.suggestedTitle || "",
      origin: peak?.source ?? "ranked",
      status: "marked" as const,
      createdAt: now,
    };
  });

  ensureVodRow(vodId);
  const database = getDb();
  const replace = database.transaction((rows: MarkedCandidate[]) => {
    database.prepare("DELETE FROM candidates WHERE vod_id = ?").run(vodId);
    for (const c of rows) {
      upsertCandidate(c);
    }
  });
  replace(candidates);

  return {
    vodId,
    candidates,
    markedPath: getDbPath(),
    highlightsPath: ranked.highlightsPath,
  };
}

export async function readMarkedCandidates(
  vodId: string
): Promise<MarkedCandidatesFile> {
  const rows = listCandidateRows(vodId);
  if (rows.length === 0) {
    throw new Error(`marked_candidates.json not found for vodId=${vodId}`);
  }
  const candidates = rows.map(rowToCandidate);
  const markedAt =
    candidates.reduce(
      (max, c) => (c.createdAt > max ? c.createdAt : max),
      candidates[0].createdAt
    ) || new Date().toISOString();
  return { vodId, candidates, markedAt };
}

export async function writeMarkedCandidates(
  file: MarkedCandidatesFile
): Promise<string> {
  ensureVodRow(file.vodId);
  const database = getDb();
  const ids = new Set((file.candidates ?? []).map((c) => c.id));

  const writeAll = database.transaction(() => {
    const existing = listCandidateRows(file.vodId);
    for (const row of existing) {
      if (!ids.has(row.id)) {
        database.prepare("DELETE FROM candidates WHERE id = ?").run(row.id);
      }
    }
    for (const c of file.candidates ?? []) {
      upsertCandidate({ ...c, vodId: file.vodId });
    }
  });
  writeAll();

  return getDbPath();
}

const RANGE_MATCH_EPS = 0.05;

export type EnsureCandidateFromMarkerInput = {
  start: number;
  end: number;
  reason?: string;
  origin?: string;
  score?: number;
};

/**
 * Find an existing marked candidate for the same VOD range, or append a new one.
 * Does not run ffmpeg/Whisper — preview/transcript stay lazy (panel trim/transcribe).
 */
export async function ensureCandidateFromMarker(
  vodId: string,
  input: EnsureCandidateFromMarkerInput
): Promise<{ candidate: MarkedCandidate; created: boolean }> {
  if (!(typeof input.start === "number") || !(typeof input.end === "number")) {
    throw new Error("start and end must be numbers");
  }
  if (!(input.end > input.start)) {
    throw new Error("end must be greater than start");
  }
  assertSegmentDurationAllowed(input.start, input.end);

  let file: MarkedCandidatesFile;
  try {
    file = await readMarkedCandidates(vodId);
  } catch {
    file = { vodId, candidates: [], markedAt: new Date().toISOString() };
  }

  const existing = (file.candidates ?? []).find(
    (c) =>
      Math.abs(c.start - input.start) <= RANGE_MATCH_EPS &&
      Math.abs(c.end - input.end) <= RANGE_MATCH_EPS
  );
  if (existing) {
    return { candidate: existing, created: false };
  }

  const now = new Date().toISOString();
  const candidate: MarkedCandidate = {
    id: randomUUID(),
    vodId,
    start: input.start,
    end: input.end,
    score: typeof input.score === "number" ? input.score : 0,
    reason: typeof input.reason === "string" ? input.reason : "",
    origin:
      typeof input.origin === "string" && input.origin
        ? input.origin
        : "timeline",
    status: "marked",
    createdAt: now,
  };

  file.candidates = [...(file.candidates ?? []), candidate];
  if (!file.markedAt) file.markedAt = now;
  file.vodId = vodId;
  await writeMarkedCandidates(file);

  return { candidate, created: true };
}

/**
 * Look up a candidate by id in SQLite (routes are /candidates/:id without vodId).
 */
export async function findMarkedCandidateById(candidateId: string): Promise<{
  vodId: string;
  file: MarkedCandidatesFile;
  candidate: MarkedCandidate;
  index: number;
}> {
  const row = getDb()
    .prepare("SELECT * FROM candidates WHERE id = ?")
    .get(candidateId) as CandidateRow | undefined;
  if (!row) {
    throw new Error(`candidate not found: ${candidateId}`);
  }

  const vodId = row.vod_id;
  const file = await readMarkedCandidates(vodId);
  const index = file.candidates.findIndex((c) => c.id === candidateId);
  if (index < 0) {
    throw new Error(`candidate not found: ${candidateId}`);
  }

  return {
    vodId,
    file,
    candidate: file.candidates[index],
    index,
  };
}
