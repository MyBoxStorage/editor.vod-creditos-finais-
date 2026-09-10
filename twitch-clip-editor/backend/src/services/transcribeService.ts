import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";

const SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "transcribe.py"
);

export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

export type SegmentTimingStatus = "original" | "partial" | "redistributed";

export type SubtitleStyleId =
  | "active_word"
  | "one_at_a_time"
  | "block_highlight"
  | "classic";

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  /** How word timings were derived after edits. */
  timingStatus?: SegmentTimingStatus;
  /** Indices into tokenized segment text for custom color highlights. */
  highlightedWordIndices?: number[];
};

export type SubtitleSettings = {
  style: SubtitleStyleId;
  uppercase: boolean;
  /** Hex color for highlight, e.g. #FFD93D */
  highlightColor: string;
  fontSize: number;
  /** Vertical position as % of frame height (baseline). Default 68. */
  positionPercent: number;
  outlineWidth: number;
  /** Seconds to keep subtitle visible after last word ends. Default 0.3. */
  tailAfterSpeechSec: number;
  /** Gaps longer than this clear the screen. Default 0.8. */
  clearGapThresholdSec: number;
};

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  style: "active_word",
  uppercase: false,
  highlightColor: "#FFD93D",
  fontSize: 72,
  positionPercent: 68,
  outlineWidth: 8,
  tailAfterSpeechSec: 0.3,
  clearGapThresholdSec: 0.8,
};

export type Transcript = {
  segments: TranscriptSegment[];
  /** Set when the user saved segment text corrections (Sprint F). */
  isManuallyEdited?: boolean;
  subtitle?: SubtitleSettings;
};

/** Live subtitle state sent with faithful preview so cache + burn match the editor. */
export type SubtitleRenderSnapshot = {
  settings: SubtitleSettings;
  segments: Array<{
    text: string;
    start: number;
    end: number;
    words?: TranscriptWord[];
    highlightedWordIndices?: number[];
    timingStatus?: TranscriptSegment["timingStatus"];
  }>;
};

export function mergeSubtitleRenderSnapshot(
  base: Transcript,
  snapshot: SubtitleRenderSnapshot
): Transcript {
  return {
    ...base,
    subtitle: snapshot.settings,
    segments: base.segments.map((seg, i) => {
      const snap = snapshot.segments[i];
      if (!snap) return seg;
      return {
        ...seg,
        text: snap.text,
        start: snap.start,
        end: snap.end,
        words: snap.words ?? seg.words,
        highlightedWordIndices: snap.highlightedWordIndices,
        timingStatus: snap.timingStatus ?? seg.timingStatus,
      };
    }),
  };
}

function getPythonCommand(): string {
  return process.env.PYTHON_PATH || process.env.PYTHON || "python";
}

type PythonRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function runPython(script: string, args: string[]): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(getPythonCommand(), [script, ...args], {
      windowsHide: true,
      shell: process.platform === "win32",
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(
        new Error(
          `Failed to start Python (${getPythonCommand()}): ${err.message}`
        )
      );
    });

    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function isValidTranscript(data: unknown): data is Transcript {
  if (!data || typeof data !== "object") return false;
  const segments = (data as Transcript).segments;
  if (!Array.isArray(segments)) return false;
  for (const seg of segments) {
    if (!seg || typeof seg !== "object") return false;
    if (typeof seg.start !== "number" || typeof seg.end !== "number") return false;
    if (typeof seg.text !== "string") return false;
    if (!Array.isArray(seg.words)) return false;
    for (const w of seg.words) {
      if (!w || typeof w !== "object") return false;
      if (typeof w.word !== "string") return false;
      if (typeof w.start !== "number" || typeof w.end !== "number") return false;
    }
  }
  return true;
}

async function readValidTranscript(transcriptPath: string): Promise<Transcript | null> {
  try {
    const stat = await fs.stat(transcriptPath);
    if (!(stat.size > 0)) return null;
    const raw = await fs.readFile(transcriptPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isValidTranscript(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Runs scripts/transcribe.py on any media file, writing JSON to outputJsonPath.
 * Timestamps are relative to the start of that media (0-based).
 * Non-zero Python exit is tolerated if the output JSON is valid (CUDA teardown crash).
 */
export async function transcribeMediaFile(
  mediaPath: string,
  outputJsonPath: string
): Promise<Transcript> {
  try {
    await fs.access(mediaPath);
  } catch {
    throw new Error(`Media not found: ${mediaPath}`);
  }

  await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
  const result = await runPython(SCRIPT_PATH, [mediaPath, outputJsonPath]);
  const transcript = await readValidTranscript(outputJsonPath);

  if (!transcript) {
    throw new Error(
      `transcribe.py exited with code ${result.code} and transcript is missing/invalid at ${outputJsonPath}: ${
        result.stderr || result.stdout || "(no output)"
      }`
    );
  }

  if (result.code !== 0) {
    console.warn(
      `[transcribe] processo saiu com código ${result.code} após gravar ${outputJsonPath} com sucesso — provável crash de teardown CUDA, ignorando`
    );
  }

  return transcript;
}

/**
 * Runs scripts/transcribe.py against the VOD source.mp4 and returns transcript.json.
 * Does not affect clip-isolated transcripts under transcripts/{candidateId}.json.
 */
export async function transcribeVod(vodId: string): Promise<{
  vodId: string;
  transcriptPath: string;
  transcript: Transcript;
}> {
  const vodDir = path.join(getDataDir(), vodId);
  const sourcePath = path.join(vodDir, "source.mp4");
  const transcriptPath = path.join(vodDir, "transcript.json");

  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`source.mp4 not found for vodId=${vodId} at ${sourcePath}`);
  }

  const transcript = await transcribeMediaFile(sourcePath, transcriptPath);
  return { vodId, transcriptPath, transcript };
}
