import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { runFfmpeg } from "../pipeline/clipRenderer";
import { getDataDir } from "./vodIngest";
import {
  tokenizeSegmentText,
  type SegmentTimingStatus,
} from "./wordTimingDiff";
import {
  transcribeMediaFile,
  type Transcript,
  type TranscriptSegment,
  type TranscriptWord,
} from "./transcribeService";
import { findClipEditableById } from "./clipEditable";
import { ensurePreviewForInterval } from "./previewIntegrity";

const SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "transcribe.py"
);

function getPythonCommand(): string {
  return process.env.PYTHON_PATH || process.env.PYTHON || "python";
}

function runPythonSegment(
  mediaPath: string,
  outputJsonPath: string,
  options: { start: number; end: number; prompt: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      SCRIPT_PATH,
      mediaPath,
      outputJsonPath,
      "--start",
      String(options.start),
      "--end",
      String(options.end),
      "--prompt",
      options.prompt,
    ];
    const child = spawn(getPythonCommand(), args, {
      windowsHide: true,
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `transcribe segment failed (${code})`));
    });
  });
}

/** Align user word tokens to whisper timings (same count → 1:1; else proportional within segment). */
function alignUserWordsToWhisper(
  userTokens: string[],
  whisperWords: TranscriptWord[],
  segStart: number,
  segEnd: number
): TranscriptWord[] {
  if (userTokens.length === 0) return [];
  if (whisperWords.length === userTokens.length) {
    return userTokens.map((token, i) => ({
      word: token,
      start: whisperWords[i].start,
      end: whisperWords[i].end,
    }));
  }
  const wStart = whisperWords[0]?.start ?? segStart;
  const wEnd = whisperWords[whisperWords.length - 1]?.end ?? segEnd;
  const duration = Math.max(0.05, wEnd - wStart);
  const step = duration / userTokens.length;
  let cursor = wStart;
  return userTokens.map((token, idx) => {
    const start = Number(cursor.toFixed(3));
    const end =
      idx === userTokens.length - 1
        ? Number(wEnd.toFixed(3))
        : Number((cursor + step).toFixed(3));
    cursor = end;
    return { word: token, start, end };
  });
}

export type ResyncSegmentResult = {
  words: TranscriptWord[];
  timingStatus: SegmentTimingStatus;
};

/**
 * Re-transcribe only the segment audio interval; keep user text, adopt new timings.
 */
export async function resyncSegmentWords(
  editableId: string,
  segmentIndex: number,
  userText: string
): Promise<ResyncSegmentResult> {
  const editable = await findClipEditableById(editableId);
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

  const { previewPath } = await ensurePreviewForInterval(
    editableId,
    editable.start,
    editable.end
  );
  const workDir = path.join(vodDir, "transcripts", `.resync_${editableId}`);
  await fs.mkdir(workDir, { recursive: true });
  const segmentWav = path.join(workDir, `seg_${segmentIndex}.wav`);
  const segmentJson = path.join(workDir, `seg_${segmentIndex}.json`);

  const pad = 0.05;
  const ss = Math.max(0, seg.start - pad);
  const dur = Math.max(0.1, seg.end - seg.start + pad * 2);

  try {
    await runFfmpeg([
      "-ss",
      String(ss),
      "-t",
      String(dur),
      "-i",
      previewPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      segmentWav,
    ]);
  } catch {
    throw new Error(
      "Não foi possível extrair o áudio do trecho para re-sincronizar. Tente de novo."
    );
  }

  try {
    await runPythonSegment(segmentWav, segmentJson, {
      start: 0,
      end: dur,
      prompt: userText.trim(),
    });
  } catch {
    try {
      await transcribeMediaFile(segmentWav, segmentJson);
    } catch {
      throw new Error(
        "A re-sincronização falhou. O timing anterior foi mantido — tente de novo em alguns segundos."
      );
    }
  }

  const whisperRaw = await fs.readFile(segmentJson, "utf-8");
  const whisper = JSON.parse(whisperRaw) as Transcript;
  const whisperWords: TranscriptWord[] = [];
  for (const ws of whisper.segments) {
    for (const w of ws.words ?? []) {
      whisperWords.push({
        word: w.word,
        start: Number((ss + w.start).toFixed(3)),
        end: Number((ss + w.end).toFixed(3)),
      });
    }
  }

  const userTokens = tokenizeSegmentText(userText);
  const words = alignUserWordsToWhisper(
    userTokens,
    whisperWords,
    seg.start,
    seg.end
  );

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

  return { words, timingStatus: "original" };
}
