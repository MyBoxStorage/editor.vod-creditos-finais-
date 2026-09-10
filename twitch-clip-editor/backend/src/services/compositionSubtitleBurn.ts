import fs from "fs/promises";
import path from "path";
import { getCaptionFontsDir, writeClipCaptions } from "../pipeline/captionGenerator";
import type { SubtitleSettings } from "../services/transcribeService";
import { DEFAULT_SUBTITLE_SETTINGS } from "../services/transcribeService";
import {
  remappedWordsToTimedSegments,
  remapCompositionSubtitleWords,
  type CompositionSegmentSubtitleInput,
} from "./compositionSubtitleRemap";
import { getDataDir } from "./vodIngest";

export type CompositionSubtitleBurnInput = {
  vodId: string;
  workDir: string;
  segmentInputs: CompositionSegmentSubtitleInput[];
  subtitleSettings?: SubtitleSettings | null;
  totalDurationSec: number;
  layoutPresetId: string;
};

export async function writeCompositionSubtitlesAss(
  input: CompositionSubtitleBurnInput
): Promise<string | null> {
  const settings: SubtitleSettings = {
    ...DEFAULT_SUBTITLE_SETTINGS,
    ...(input.subtitleSettings ?? {}),
  };

  const words = remapCompositionSubtitleWords(input.segmentInputs);
  if (words.length === 0) return null;

  const segments = remappedWordsToTimedSegments(words);
  const transcriptOverride = {
    segments,
    text: segments.map((s) => s.text).join(" "),
  };

  await fs.mkdir(input.workDir, { recursive: true });
  const assPath = path.join(input.workDir, "composition_subtitles.ass");

  await writeClipCaptions({
    transcriptPath: assPath,
    layoutPresetId: input.layoutPresetId,
    clipStart: 0,
    clipEnd: input.totalDurationSec,
    keepAbsoluteTimes: true,
    subtitleSettings: settings,
    transcriptOverride,
    outputAssPath: assPath,
  });

  return assPath;
}

export function escapeFfmpegSubtitlesPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
}

export function buildSubtitlesFilter(assPath: string): string {
  const escapedAss = escapeFfmpegSubtitlesPath(assPath);
  const fontsDir = escapeFfmpegSubtitlesPath(getCaptionFontsDir());
  return `subtitles='${escapedAss}':fontsdir='${fontsDir}'`;
}
