import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import type { PeakCandidate } from "../pipeline/chatPeakDetector";
import { detectLaughterHypePeaks } from "../pipeline/laughterHypeDetector";
import {
  runSemanticScan,
  type SemanticMoment,
} from "./semanticScanService";
import { beginPipelineRun } from "./pipelineRun";

// chatPeakDetector.ts / chat.json: desativado por enquanto, sem audiência ainda —
// reativar quando houver chat com volume real (trocar o bloco abaixo por detectChatPeaks).
// fallbackPeakDetector.ts permanece no repo como legado, mas não é mais a fonte primária.
//
// Fonte PRIMÁRIA: varredura semântica (semantic_candidates.json).
// laughterHypeDetector continua gerando o artefato acústico (acoustic_candidates.json)
// e serve só como reforço de score quando há overlap temporal.

export type CandidatesResult = {
  vodId: string;
  method: "chat" | "fallback" | "laughterHype" | "semantic";
  candidates: PeakCandidate[];
  candidatesPath: string;
  runId: string;
};

const SEMANTIC_BASE_SCORE = 5;
const ACOUSTIC_OVERLAP_BOOST = 2;

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function combineSemanticWithAcoustic(
  semantic: SemanticMoment[],
  acoustic: PeakCandidate[]
): PeakCandidate[] {
  return semantic.map((s) => {
    const overlaps = acoustic.filter((a) =>
      rangesOverlap(s.start, s.end, a.start, a.end)
    );

    let source: PeakCandidate["source"] = "semantic";
    let score = typeof s.score === "number" ? s.score : SEMANTIC_BASE_SCORE;
    const samples = [
      `[semantic score=${typeof s.score === "number" ? s.score : "?"}] ${s.title}`,
      s.reason,
    ];

    if (overlaps.length > 0) {
      score += ACOUSTIC_OVERLAP_BOOST;
      const sources = new Set(
        overlaps.map((o) => o.source).filter(Boolean) as string[]
      );
      const hasBoth = sources.has("both");
      const hasLaugh = sources.has("laughter") || hasBoth;
      const hasEnergy = sources.has("energy") || hasBoth;
      if (hasLaugh && hasEnergy) source = "semantic+both";
      else if (hasLaugh) source = "semantic+laughter";
      else if (hasEnergy) source = "semantic+energy";
      else source = "semantic+both";

      const best = overlaps.reduce((a, b) => (a.score > b.score ? a : b));
      samples.push(
        `[acoustic boost +${ACOUSTIC_OVERLAP_BOOST}] overlap score=${best.score.toFixed(2)} source=${best.source ?? "unknown"}`
      );
    }

    return {
      start: s.start,
      end: s.end,
      score,
      sampleMessages: samples,
      source,
    };
  });
}

export async function detectCandidates(vodId: string): Promise<CandidatesResult> {
  const vodDir = path.join(getDataDir(), vodId);
  const sourcePath = path.join(vodDir, "source.mp4");
  const candidatesPath = path.join(vodDir, "candidates.json");
  const acousticPath = path.join(vodDir, "acoustic_candidates.json");
  const semanticPath = path.join(vodDir, "semantic_candidates.json");

  try {
    await fs.access(sourcePath);
  } catch {
    throw new Error(`source.mp4 not found for vodId=${vodId}`);
  }

  let metaDuration: number | undefined;
  try {
    const metaRaw = await fs.readFile(path.join(vodDir, "meta.json"), "utf-8");
    const meta = JSON.parse(metaRaw) as { duration?: number | null };
    if (typeof meta.duration === "number") metaDuration = meta.duration;
  } catch {
    // optional
  }

  // Acoustic channel (unchanged detector) — reinforcement only
  const acoustic = await detectLaughterHypePeaks(vodId, sourcePath, vodDir, {
    vodDurationSeconds: metaDuration,
  });
  await fs.writeFile(
    acousticPath,
    JSON.stringify({ method: "laughterHype", candidates: acoustic }, null, 2),
    "utf-8"
  );

  // Semantic primary — reuse prior scan if present, otherwise run it
  let semanticMoments: SemanticMoment[];
  try {
    const raw = await fs.readFile(semanticPath, "utf-8");
    const parsed = JSON.parse(raw) as { candidates?: SemanticMoment[] };
    if (!parsed.candidates || !Array.isArray(parsed.candidates)) {
      throw new Error("invalid semantic_candidates.json");
    }
    semanticMoments = parsed.candidates;
  } catch {
    const scan = await runSemanticScan(vodId);
    semanticMoments = scan.candidates;
  }

  const candidates = combineSemanticWithAcoustic(semanticMoments, acoustic).sort(
    (a, b) => b.score - a.score
  );

  const method: CandidatesResult["method"] = "semantic";
  const run = await beginPipelineRun(vodId, "semantic");

  const payload = {
    method,
    runId: run.runId,
    candidates,
    sources: {
      semantic: semanticPath,
      acoustic: acousticPath,
    },
  };
  await fs.writeFile(candidatesPath, JSON.stringify(payload, null, 2), "utf-8");

  return { vodId, method, candidates, candidatesPath, runId: run.runId };
}
