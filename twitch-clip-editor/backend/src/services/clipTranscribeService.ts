import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { runFfmpeg } from "../pipeline/clipRenderer";
import { writeClipCaptions } from "../pipeline/captionGenerator";
import {
  transcribeMediaFile,
  DEFAULT_SUBTITLE_SETTINGS,
  type Transcript,
  type TranscriptSegment,
} from "./transcribeService";
import { ensurePreviewForInterval } from "./previewIntegrity";
import {
  findClipEditableById,
  saveClipEditable,
  type ClipEditable,
} from "./clipEditable";
import {
  reconcileSegmentWordTimings,
  remapHighlightedWordIndices,
} from "./wordTimingDiff";
import {
  applyGlossaryToTranscript,
  loadGlossary,
  saveGlossary,
  type Glossary,
} from "./subtitleGlossaryService";
import { resyncSegmentWords } from "./segmentResyncService";

export function formatSrtTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function transcriptToSrt(transcript: Transcript): string {
  const blocks: string[] = [];
  let i = 1;
  for (const seg of transcript.segments) {
    const text = seg.text.trim();
    if (!text) continue;
    blocks.push(
      `${i}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${text}\n`
    );
    i += 1;
  }
  return blocks.join("\n");
}

function transcriptDuration(transcript: Transcript): number {
  let max = 0;
  for (const seg of transcript.segments) {
    if (seg.end > max) max = seg.end;
    for (const w of seg.words ?? []) {
      if (w.end > max) max = w.end;
    }
  }
  return max;
}

export type TranscribeClipResult = {
  candidate: ClipEditable;
  transcript: Transcript;
  transcriptPath: string;
  assPath: string;
  srtPath: string;
  wavPath: string;
};

export type SaveTranscriptSegmentEdit = {
  index: number;
  text: string;
  highlightedWordIndices?: number[];
};

export type SaveClipTranscriptOptions = {
  layoutPresetId?: string;
  subtitle?: Transcript["subtitle"];
};

export type SaveClipTranscriptResult = {
  candidate: ClipEditable;
  transcript: Transcript;
  transcriptPath: string;
  assPath: string;
  srtPath: string;
};

/**
 * Overwrite segment text; preserve word timings via diff when possible.
 */
export async function saveClipTranscript(
  editableId: string,
  edits: SaveTranscriptSegmentEdit[],
  options?: SaveClipTranscriptOptions
): Promise<SaveClipTranscriptResult> {
  const editable = { ...(await findClipEditableById(editableId)) };
  const vodId = editable.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const transcriptPath = path.join(
    vodDir,
    editable.clipTranscriptRelativePath ?? `transcripts/${editableId}.json`
  );
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, "utf-8");
  } catch {
    throw new Error(
      `Clip transcript not found for candidate ${editableId}. Run POST /candidates/${editableId}/transcribe-clip first.`
    );
  }

  const transcript = JSON.parse(raw) as Transcript;
  if (!Array.isArray(transcript.segments)) {
    throw new Error(`Invalid transcript JSON at ${transcriptPath}`);
  }

  const n = transcript.segments.length;
  if (!Array.isArray(edits)) {
    throw new Error("Body must include segments: array");
  }
  if (edits.length !== n) {
    throw new Error(
      `segments length mismatch: got ${edits.length}, expected ${n} (same count as transcript)`
    );
  }

  const seen = new Set<number>();
  for (const item of edits) {
    if (
      !item ||
      typeof item.index !== "number" ||
      !Number.isInteger(item.index)
    ) {
      throw new Error("Each segment edit must have integer index");
    }
    if (item.index < 0 || item.index >= n) {
      throw new Error(
        `segment index ${item.index} out of range (valid 0..${n - 1})`
      );
    }
    if (seen.has(item.index)) {
      throw new Error(`duplicate segment index ${item.index}`);
    }
    if (typeof item.text !== "string") {
      throw new Error(`segment index ${item.index}: text must be a string`);
    }
    seen.add(item.index);
  }
  if (seen.size !== n) {
    throw new Error(
      `segments must cover every index 0..${n - 1} exactly once (missing indices)`
    );
  }

  for (const item of edits) {
    const seg = transcript.segments[item.index] as TranscriptSegment;
    const oldWords = [...(seg.words ?? [])];
    const oldHighlights = [...(seg.highlightedWordIndices ?? [])];

    if (seg.text !== item.text) {
      const { words, timingStatus } = reconcileSegmentWordTimings(
        oldWords,
        item.text,
        seg.start,
        seg.end
      );
      seg.text = item.text;
      seg.words = words;
      seg.timingStatus = timingStatus;
      seg.highlightedWordIndices =
        item.highlightedWordIndices ??
        remapHighlightedWordIndices(oldWords, oldHighlights, item.text);
    } else {
      seg.text = item.text;
      if (item.highlightedWordIndices) {
        seg.highlightedWordIndices = item.highlightedWordIndices;
      }
    }
  }

  if (options?.subtitle) {
    transcript.subtitle = { ...DEFAULT_SUBTITLE_SETTINGS, ...options.subtitle };
  }

  transcript.isManuallyEdited = true;

  const transcriptsDir = path.join(vodDir, "transcripts");
  await fs.mkdir(transcriptsDir, { recursive: true });
  const assPath = path.join(transcriptsDir, `${editableId}.ass`);
  const srtPath = path.join(transcriptsDir, `${editableId}.srt`);

  await fs.writeFile(
    transcriptPath,
    JSON.stringify(transcript, null, 2),
    "utf-8"
  );

  const clipEnd = Math.max(transcriptDuration(transcript), 0.1);
  const layoutPresetId =
    options?.layoutPresetId && typeof options.layoutPresetId === "string"
      ? options.layoutPresetId
      : "vertical-split-9x16";

  await writeClipCaptions({
    transcriptPath,
    clipStart: 0,
    clipEnd,
    layoutPresetId,
    outputAssPath: assPath,
    subtitleSettings: transcript.subtitle ?? DEFAULT_SUBTITLE_SETTINGS,
  });
  await fs.writeFile(srtPath, transcriptToSrt(transcript), "utf-8");

  editable.isManuallyEdited = true;
  editable.clipTranscriptRelativePath = `transcripts/${editableId}.json`;
  editable.clipAssRelativePath = `transcripts/${editableId}.ass`;
  editable.clipSrtRelativePath = `transcripts/${editableId}.srt`;
  await saveClipEditable(editable);

  return {
    candidate: editable,
    transcript,
    transcriptPath,
    assPath,
    srtPath,
  };
}

/**
 * Isolated Whisper on the preview only (candidate or clip_segment).
 * Never reads or writes the VOD-level transcript.json.
 */
export async function transcribeClip(
  editableId: string,
  options?: { layoutPresetId?: string }
): Promise<TranscribeClipResult> {
  let editable = { ...(await findClipEditableById(editableId)) };
  const vodId = editable.vodId;
  const vodDir = path.join(getDataDir(), vodId);

  const { previewPath, editable: refreshed } = await ensurePreviewForInterval(
    editableId,
    editable.start,
    editable.end
  );
  editable = { ...refreshed };

  const transcriptsDir = path.join(vodDir, "transcripts");
  await fs.mkdir(transcriptsDir, { recursive: true });
  const wavPath = path.join(transcriptsDir, `${editableId}.wav`);
  const transcriptPath = path.join(transcriptsDir, `${editableId}.json`);
  const assPath = path.join(transcriptsDir, `${editableId}.ass`);
  const srtPath = path.join(transcriptsDir, `${editableId}.srt`);

  await runFfmpeg([
    "-i",
    previewPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    wavPath,
  ]);

  const transcript = await transcribeMediaFile(wavPath, transcriptPath);
  delete transcript.isManuallyEdited;
  const glossary = await loadGlossary();
  const withGlossary = applyGlossaryToTranscript(transcript, glossary.entries);
  withGlossary.subtitle = { ...DEFAULT_SUBTITLE_SETTINGS };
  for (const seg of withGlossary.segments) {
    seg.timingStatus = "original";
    seg.highlightedWordIndices = [];
  }
  await fs.writeFile(
    transcriptPath,
    JSON.stringify(withGlossary, null, 2),
    "utf-8"
  );

  const clipEnd = Math.max(transcriptDuration(withGlossary), 0.1);
  const layoutPresetId =
    options?.layoutPresetId && typeof options.layoutPresetId === "string"
      ? options.layoutPresetId
      : "vertical-split-9x16";

  await writeClipCaptions({
    transcriptPath,
    clipStart: 0,
    clipEnd,
    layoutPresetId,
    outputAssPath: assPath,
    subtitleSettings: withGlossary.subtitle ?? DEFAULT_SUBTITLE_SETTINGS,
  });
  await fs.writeFile(srtPath, transcriptToSrt(withGlossary), "utf-8");

  editable.status = "transcribed";
  editable.isManuallyEdited = false;
  editable.clipTranscriptRelativePath = `transcripts/${editableId}.json`;
  editable.clipAssRelativePath = `transcripts/${editableId}.ass`;
  editable.clipSrtRelativePath = `transcripts/${editableId}.srt`;
  if (!editable.previewRelativePath) {
    editable.previewRelativePath = `previews/${editableId}.mp4`;
  }

  await saveClipEditable(editable);

  return {
    candidate: editable,
    transcript: withGlossary,
    transcriptPath,
    assPath,
    srtPath,
    wavPath,
  };
}

export async function resyncClipSegment(
  editableId: string,
  segmentIndex: number,
  options?: { layoutPresetId?: string }
): Promise<SaveClipTranscriptResult> {
  const editable = { ...(await findClipEditableById(editableId)) };
  const vodDir = path.join(getDataDir(), editable.vodId);
  const transcriptPath = path.join(
    vodDir,
    editable.clipTranscriptRelativePath ?? `transcripts/${editableId}.json`
  );
  const raw = await fs.readFile(transcriptPath, "utf-8");
  const transcript = JSON.parse(raw) as Transcript;
  const seg = transcript.segments[segmentIndex];
  if (!seg) {
    throw new Error(`segment index ${segmentIndex} out of range`);
  }

  const { words, timingStatus } = await resyncSegmentWords(
    editableId,
    segmentIndex,
    seg.text
  );
  seg.words = words;
  seg.timingStatus = timingStatus;

  const assPath = path.join(vodDir, "transcripts", `${editableId}.ass`);
  const srtPath = path.join(vodDir, "transcripts", `${editableId}.srt`);
  await fs.writeFile(
    transcriptPath,
    JSON.stringify(transcript, null, 2),
    "utf-8"
  );

  const clipEnd = Math.max(transcriptDuration(transcript), 0.1);
  const layoutPresetId =
    options?.layoutPresetId && typeof options.layoutPresetId === "string"
      ? options.layoutPresetId
      : "vertical-split-9x16";

  await writeClipCaptions({
    transcriptPath,
    clipStart: 0,
    clipEnd,
    layoutPresetId,
    outputAssPath: assPath,
    subtitleSettings: transcript.subtitle ?? DEFAULT_SUBTITLE_SETTINGS,
  });
  await fs.writeFile(srtPath, transcriptToSrt(transcript), "utf-8");
  await saveClipEditable(editable);

  return {
    candidate: editable,
    transcript,
    transcriptPath,
    assPath,
    srtPath,
  };
}

export { loadGlossary, saveGlossary, type Glossary };
