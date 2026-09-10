import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import type { SemanticMoment } from "./semanticScanService";
import type { PeakCandidate } from "../pipeline/chatPeakDetector";
import type { Highlight } from "./claudeHighlightRanker";

export type SemanticCandidateView = SemanticMoment & {
  wasRankedByClaude: boolean;
};

export type AcousticCandidateView = PeakCandidate & {
  wasRankedByClaude: boolean;
};

export type AllCandidatesResult = {
  vodId: string;
  semanticCandidates: SemanticCandidateView[];
  acousticCandidates: AcousticCandidateView[];
  rankedHighlights: Highlight[];
};

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function wasRanked(
  start: number,
  end: number,
  highlights: Highlight[]
): boolean {
  return highlights.some((h) => rangesOverlap(start, end, h.start, h.end));
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getAllCandidates(
  vodId: string
): Promise<AllCandidatesResult> {
  const vodDir = path.join(getDataDir(), vodId);

  const [semanticFile, acousticFile, highlightsFile] = await Promise.all([
    readJsonIfExists<{ candidates?: SemanticMoment[] }>(
      path.join(vodDir, "semantic_candidates.json")
    ),
    readJsonIfExists<{ candidates?: PeakCandidate[] }>(
      path.join(vodDir, "acoustic_candidates.json")
    ),
    readJsonIfExists<{ highlights?: Highlight[] }>(
      path.join(vodDir, "highlights.json")
    ),
  ]);

  // Require at least one candidate source to exist
  if (!semanticFile && !acousticFile) {
    throw new Error(
      `No candidate files found for vodId=${vodId} (expected semantic_candidates.json and/or acoustic_candidates.json)`
    );
  }

  const rankedHighlights = highlightsFile?.highlights ?? [];

  const semanticCandidates: SemanticCandidateView[] = (
    semanticFile?.candidates ?? []
  ).map((c) => ({
    ...c,
    wasRankedByClaude: wasRanked(c.start, c.end, rankedHighlights),
  }));

  const acousticCandidates: AcousticCandidateView[] = (
    acousticFile?.candidates ?? []
  ).map((c) => ({
    ...c,
    wasRankedByClaude: wasRanked(c.start, c.end, rankedHighlights),
  }));

  return {
    vodId,
    semanticCandidates,
    acousticCandidates,
    rankedHighlights,
  };
}
