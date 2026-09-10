import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import type { Transcript } from "./transcribeService";
import type { Highlight } from "./claudeHighlightRanker";
import type { PeakCandidate } from "../pipeline/chatPeakDetector";
import type { LaughterEvent } from "../pipeline/laughterHypeDetector";

export type HighlightDiagnostic = {
  vodId: string;
  index: number;
  highlight: Highlight;
  transcriptText: string;
  transcriptSegments: Array<{ start: number; end: number; text: string }>;
  laughterEvents: LaughterEvent[];
  energyCandidates: Array<{
    start: number;
    end: number;
    score: number;
    source?: string;
    sampleMessages: string[];
  }>;
};

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Diagnostic payload for one highlight — judge before exporting video.
 */
export async function getHighlightDiagnostic(
  vodId: string,
  index: number
): Promise<HighlightDiagnostic> {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid highlight index: ${index}`);
  }

  const vodDir = path.join(getDataDir(), vodId);
  const highlightsPath = path.join(vodDir, "highlights.json");
  const transcriptPath = path.join(vodDir, "transcript.json");
  const laughterPath = path.join(vodDir, "laughter.json");
  const candidatesPath = path.join(vodDir, "candidates.json");

  const highlightsRaw = await fs.readFile(highlightsPath, "utf-8");
  const highlightsFile = JSON.parse(highlightsRaw) as { highlights: Highlight[] };
  const highlights = highlightsFile.highlights ?? [];
  if (index >= highlights.length) {
    throw new Error(
      `Highlight index ${index} out of range (have ${highlights.length})`
    );
  }
  const highlight = highlights[index];

  const transcript = JSON.parse(
    await fs.readFile(transcriptPath, "utf-8")
  ) as Transcript;

  const transcriptSegments = transcript.segments
    .filter((s) => rangesOverlap(highlight.start, highlight.end, s.start, s.end))
    .map((s) => ({ start: s.start, end: s.end, text: s.text }));

  const transcriptText =
    transcriptSegments.map((s) => s.text).join(" ").trim() ||
    "(sem transcrição neste intervalo)";

  let laughterEvents: LaughterEvent[] = [];
  try {
    const laughterFile = JSON.parse(
      await fs.readFile(laughterPath, "utf-8")
    ) as { events?: LaughterEvent[] };
    laughterEvents = (laughterFile.events ?? []).filter((e) =>
      rangesOverlap(highlight.start, highlight.end, e.start, e.end)
    );
  } catch {
    laughterEvents = [];
  }

  let energyCandidates: HighlightDiagnostic["energyCandidates"] = [];
  try {
    const candidatesFile = JSON.parse(
      await fs.readFile(candidatesPath, "utf-8")
    ) as { candidates?: PeakCandidate[] };
    energyCandidates = (candidatesFile.candidates ?? [])
      .filter((c) =>
        rangesOverlap(highlight.start, highlight.end, c.start, c.end)
      )
      .map((c) => ({
        start: c.start,
        end: c.end,
        score: c.score,
        source: c.source,
        sampleMessages: c.sampleMessages ?? [],
      }));
  } catch {
    energyCandidates = [];
  }

  return {
    vodId,
    index,
    highlight,
    transcriptText,
    transcriptSegments,
    laughterEvents,
    energyCandidates,
  };
}
