import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { ingestVod, getDataDir } from "../services/vodIngest";
import { transcribeVod } from "../services/transcribeService";
import { detectCandidates } from "../services/candidatesService";
import { rankHighlights } from "../services/claudeHighlightRanker";
import { runSemanticScan } from "../services/semanticScanService";
import { renderClip } from "../pipeline/clipRenderer";
import { listLayoutPresets } from "../pipeline/layoutPresets";
import { generateAndBurnCaptions } from "../services/captionService";
import { exportClip } from "../services/exportService";
import { getHighlightDiagnostic } from "../services/highlightDiagnostic";
import { getAllCandidates } from "../services/allCandidatesService";
import { listProntosRuns, listVods } from "../services/vodDashboardService";
import {
  ensureCandidateFromMarker,
  markCandidates,
  readMarkedCandidates,
} from "../services/markedCandidatesService";
import {
  createClipSegment,
  listClipSegmentsForVod,
} from "../services/clipSegmentsService";
import {
  extractAndStoreChapters,
  readChapters,
} from "../services/vodChaptersService";
import { getOrCreateWaveform } from "../services/vodWaveformService";
import { getOrCreateNavThumbnailStrip } from "../services/vodThumbnailStripService";

export const vodRouter = Router();

vodRouter.get("/vods", async (_req, res) => {
  try {
    const vods = await listVods();
    res.json({ count: vods.length, vods });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.get("/layouts", (_req, res) => {
  res.json({ presets: listLayoutPresets() });
});

vodRouter.get("/vod/:vodId/meta", async (req, res) => {
  const { vodId } = req.params;
  try {
    const raw = await fs.readFile(
      path.join(getDataDir(), vodId, "meta.json"),
      "utf-8"
    );
    res.json(JSON.parse(raw));
  } catch {
    // Fallback: probe source if meta missing (e.g. test fixtures)
    try {
      await fs.access(path.join(getDataDir(), vodId, "source.mp4"));
      res.json({ id: vodId, title: vodId, duration: null });
    } catch {
      res.status(404).json({ error: `meta not found for vodId=${vodId}` });
    }
  }
});

vodRouter.get("/vod/:vodId/chapters", async (req, res) => {
  const { vodId } = req.params;
  try {
    let chapters = await readChapters(vodId);
    if (chapters.length === 0) {
      chapters = await extractAndStoreChapters(vodId);
    }
    res.json({ vodId, chapters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.get("/vod/:vodId/waveform", async (req, res) => {
  const { vodId } = req.params;
  try {
    const wf = await getOrCreateWaveform(vodId);
    res.json({ vodId, ...wf });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.get("/vod/:vodId/nav-thumbnails", async (req, res) => {
  const { vodId } = req.params;
  try {
    const strip = await getOrCreateNavThumbnailStrip(vodId);
    res.json({ vodId, ...strip });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.get("/vod/:vodId/prontos-runs", async (req, res) => {
  const { vodId } = req.params;
  try {
    await fs.access(path.join(getDataDir(), vodId));
  } catch {
    res.status(404).json({ error: `vod not found: ${vodId}` });
    return;
  }
  try {
    const runs = await listProntosRuns(vodId);
    res.json({ vodId, count: runs.length, runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.get("/vod/:vodId/highlights", async (req, res) => {
  const { vodId } = req.params;
  try {
    const raw = await fs.readFile(
      path.join(getDataDir(), vodId, "highlights.json"),
      "utf-8"
    );
    const data = JSON.parse(raw) as { highlights: unknown[] };
    res.json({ vodId, highlights: data.highlights ?? [] });
  } catch {
    res.status(404).json({ error: `highlights not found for vodId=${vodId}` });
  }
});

/**
 * Raw semantic + acoustic candidates (separate lists), each tagged with
 * wasRankedByClaude based on overlap with highlights.json.
 */
vodRouter.get("/vod/:vodId/all-candidates", async (req, res) => {
  const { vodId } = req.params;
  try {
    const result = await getAllCandidates(vodId);
    res.json({
      vodId: result.vodId,
      semanticCount: result.semanticCandidates.length,
      acousticCount: result.acousticCandidates.length,
      rankedCount: result.rankedHighlights.length,
      semanticCandidates: result.semanticCandidates,
      acousticCandidates: result.acousticCandidates,
      rankedHighlights: result.rankedHighlights,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("No candidate")
        ? 404
        : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.get("/vod/:vodId/highlights/:index/diagnostic", async (req, res) => {
  const { vodId, index: indexRaw } = req.params;
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0) {
    res.status(400).json({ error: "index must be a non-negative integer" });
    return;
  }

  try {
    const diagnostic = await getHighlightDiagnostic(vodId, index);
    res.json(diagnostic);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") ||
      message.includes("out of range") ||
      message.includes("ENOENT")
        ? 404
        : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.post("/vod/ingest", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Body must include { url: string }" });
    return;
  }

  try {
    const result = await ingestVod(url);
    res.status(200).json({
      vodId: result.vodId,
      status: result.status,
      meta: result.meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/transcribe", async (req, res) => {
  const { vodId } = req.params;

  try {
    const result = await transcribeVod(vodId);
    res.status(200).json({
      vodId: result.vodId,
      status: "completed",
      transcriptPath: result.transcriptPath,
      segmentCount: result.transcript.segments.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/semantic-scan", async (req, res) => {
  const { vodId } = req.params;
  const bodyMin =
    req.body && typeof req.body.minScore === "number"
      ? req.body.minScore
      : undefined;

  try {
    const result = await runSemanticScan(vodId, {
      minScore: bodyMin,
      onWindow: (info) => {
        console.log(
          `[semantic-scan] window ${info.index + 1}/${info.total} ${info.start.toFixed(0)}-${info.end.toFixed(0)}s → ${info.momentCount} moment(s)`
        );
      },
    });
    res.status(200).json({
      vodId: result.vodId,
      status: "completed",
      model: result.model,
      minScore: result.minScore,
      windowCount: result.windowCount,
      windowSeconds: result.windowSeconds,
      overlapSeconds: result.overlapSeconds,
      scoredCount: result.scoredMoments.length,
      count: result.candidates.length,
      usage: result.usage,
      scoredMoments: result.scoredMoments,
      candidates: result.candidates,
      semanticPath: result.semanticPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("ENOENT") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/candidates", async (req, res) => {
  const { vodId } = req.params;

  try {
    const result = await detectCandidates(vodId);
    res.status(200).json({
      vodId: result.vodId,
      status: "completed",
      method: result.method,
      runId: result.runId,
      count: result.candidates.length,
      candidates: result.candidates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/rank-highlights", async (req, res) => {
  const { vodId } = req.params;

  try {
    const result = await rankHighlights(vodId);
    res.status(200).json({
      vodId: result.vodId,
      status: "completed",
      count: result.highlights.length,
      highlights: result.highlights,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") || message.includes("No candidates")
      ? 404
      : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Checkpoint "mark": rank approved peaks → persist marked_candidates.json.
 * Does not call ffmpeg, Whisper, or exportService.
 */
vodRouter.post("/vod/:vodId/mark-candidates", async (req, res) => {
  const { vodId } = req.params;

  try {
    const result = await markCandidates(vodId);
    res.status(200).json({
      vodId: result.vodId,
      status: "completed",
      count: result.candidates.length,
      candidates: result.candidates,
      markedPath: result.markedPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("not found") || message.includes("No candidates")
        ? 404
        : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Read marked_candidates.json (Sprint A). Does not run detection or ranking.
 */
vodRouter.get("/vod/:vodId/marked-candidates", async (req, res) => {
  const { vodId } = req.params;

  try {
    const file = await readMarkedCandidates(vodId);
    res.status(200).json(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Body: { start, end, reason?, origin?, score? }
 * Reuse existing marked candidate for the same range, or append a new one.
 * No ffmpeg/Whisper — panel handles trim/transcribe lazily.
 */
vodRouter.post("/vod/:vodId/ensure-candidate", async (req, res) => {
  const { vodId } = req.params;
  const { start, end, reason, origin, score } = req.body ?? {};

  if (typeof start !== "number" || typeof end !== "number") {
    res.status(400).json({
      error: "Body must include { start: number, end: number }",
    });
    return;
  }

  try {
    const result = await ensureCandidateFromMarker(vodId, {
      start,
      end,
      reason: typeof reason === "string" ? reason : undefined,
      origin: typeof origin === "string" ? origin : undefined,
      score: typeof score === "number" ? score : undefined,
    });
    res.status(200).json({
      status: "completed",
      created: result.created,
      candidate: result.candidate,
      candidateId: result.candidate.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("must be") || message.includes("greater") || message.includes("Trecho muito longo")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Body: { start, end, candidateId?, role? }
 * Always creates a NEW clip_segment (Layer 2) — never reuses by range.
 */
vodRouter.post("/vod/:vodId/clip-segments", async (req, res) => {
  const { vodId } = req.params;
  const { start, end, candidateId, role } = req.body ?? {};

  if (typeof start !== "number" || typeof end !== "number") {
    res.status(400).json({
      error: "Body must include { start: number, end: number }",
    });
    return;
  }

  try {
    const segment = createClipSegment({
      vodId,
      start,
      end,
      candidateId:
        typeof candidateId === "string" ? candidateId : undefined,
      role: role === "hook" || role === "normal" ? role : undefined,
    });
    res.status(200).json({
      status: "completed",
      clipSegment: segment,
      clipSegmentId: segment.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.includes("must be") ||
      message.includes("greater") ||
      message.includes("candidate not found") ||
      message.includes("Trecho muito longo")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * List Layer-2 clip_segments for a VOD, ordered by source_start ascending.
 */
vodRouter.get("/vod/:vodId/clip-segments", async (req, res) => {
  const { vodId } = req.params;
  try {
    const segments = listClipSegmentsForVod(vodId);
    res.status(200).json({
      vodId,
      count: segments.length,
      clipSegments: segments,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/clips", async (req, res) => {
  const { vodId } = req.params;
  const { start, end, layoutPresetId } = req.body ?? {};

  if (typeof start !== "number" || typeof end !== "number" || !layoutPresetId) {
    res.status(400).json({
      error: "Body must include { start: number, end: number, layoutPresetId: string }",
    });
    return;
  }

  try {
    const result = await renderClip({
      vodId,
      start,
      end,
      layoutPresetId: String(layoutPresetId),
    });
    res.status(200).json({
      vodId,
      clipId: result.clipId,
      status: "completed",
      rawPath: result.rawPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") || message.includes("Unknown")
      ? 404
      : 500;
    res.status(status).json({ error: message });
  }
});

vodRouter.post("/vod/:vodId/clips/:clipId/captions", async (req, res) => {
  const { vodId, clipId } = req.params;

  try {
    const result = await generateAndBurnCaptions(vodId, clipId);
    res.status(200).json({
      vodId: result.vodId,
      clipId: result.clipId,
      status: "completed",
      assPath: result.assPath,
      finalPath: result.finalPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

/**
 * Full export with SSE progress events:
 * event: progress  data: { step }
 * event: done      data: ExportResult
 * event: error     data: { error }
 *
 * Body: { start, end, layoutPresetId, hookStart?, hookEnd? }
 * Re-exports version as final.mp4, final_v2.mp4, ...
 * Optional hook is prepended (concat demuxer) when both hookStart/hookEnd are set.
 */
vodRouter.post("/vod/:vodId/clips/:clipId/export", async (req, res) => {
  const { vodId, clipId } = req.params;
  const { start, end, layoutPresetId, hookStart, hookEnd } = req.body ?? {};

  if (typeof start !== "number" || typeof end !== "number" || !layoutPresetId) {
    res.status(400).json({
      error:
        "Body must include { start: number, end: number, layoutPresetId: string }",
    });
    return;
  }

  if (
    (hookStart !== undefined && typeof hookStart !== "number") ||
    (hookEnd !== undefined && typeof hookEnd !== "number")
  ) {
    res.status(400).json({
      error: "hookStart/hookEnd must be numbers when provided",
    });
    return;
  }

  const hookOpts =
    typeof hookStart === "number" && typeof hookEnd === "number"
      ? { hookStart, hookEnd }
      : {};

  const wantsSse = String(req.headers.accept || "").includes("text/event-stream");

  if (wantsSse) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await exportClip(vodId, clipId, {
        start,
        end,
        layoutPresetId: String(layoutPresetId),
        ...hookOpts,
        onProgress: (step) => send("progress", { step }),
      });
      send("done", result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send("error", { error: message });
    } finally {
      res.end();
    }
    return;
  }

  try {
    const result = await exportClip(vodId, clipId, {
      start,
      end,
      layoutPresetId: String(layoutPresetId),
      ...hookOpts,
    });
    res.status(200).json({ status: "completed", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
