import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import type { Transcript, TranscriptSegment } from "./transcribeService";

const MODEL = "claude-sonnet-4-6";

/** Default ~4 min windows with 20s overlap (≈12–18 calls for a ~53 min VOD). */
const DEFAULT_WINDOW_SECONDS = 240;
const DEFAULT_OVERLAP_SECONDS = 20;
const DEFAULT_MIN_MOMENT_SCORE = 7;

/**
 * Threshold for keeping a moment in `candidates` (pipeline primary list).
 * Override with SEMANTIC_SCAN_MIN_SCORE or options.minScore.
 * All scored moments (including below threshold) are still saved in `scoredMoments`.
 */
export function resolveMinMomentScore(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.min(10, Math.max(1, Math.round(override)));
  }
  const raw = process.env.SEMANTIC_SCAN_MIN_SCORE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(10, Math.max(1, Math.round(n)));
    }
  }
  return DEFAULT_MIN_MOMENT_SCORE;
}

export type SemanticMoment = {
  start: number;
  end: number;
  title: string;
  reason: string;
  /** Claude interest score 1–10. */
  score: number;
  windowIndex: number;
  windowStart: number;
  windowEnd: number;
  /** Segment text covering this moment (for human review). */
  transcriptSnippet: string;
};

export type SemanticScanResult = {
  vodId: string;
  model: string;
  windowSeconds: number;
  overlapSeconds: number;
  windowCount: number;
  durationSec: number;
  minScore: number;
  /** Every moment Claude scored (before threshold filter), sorted by score desc. */
  scoredMoments: SemanticMoment[];
  /** Moments with score >= minScore (used downstream as semantic candidates). */
  candidates: SemanticMoment[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  semanticPath: string;
};

type WindowSpec = {
  index: number;
  start: number;
  end: number;
};

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY (or CLAUDE_API_KEY). Set it in the environment or backend/.env"
    );
  }
  return key;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  // Claude Sonnet 4.6 standard API: $3 / MTok in, $15 / MTok out (Jul 2026)
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

function transcriptDurationSec(transcript: Transcript, fallback?: number): number {
  let maxEnd = 0;
  for (const seg of transcript.segments) {
    if (seg.end > maxEnd) maxEnd = seg.end;
  }
  if (maxEnd > 0) return maxEnd;
  if (typeof fallback === "number" && fallback > 0) return fallback;
  return 0;
}

function buildWindows(
  durationSec: number,
  windowSeconds: number,
  overlapSeconds: number
): WindowSpec[] {
  if (durationSec <= 0) return [];
  const step = Math.max(1, windowSeconds - overlapSeconds);
  const windows: WindowSpec[] = [];
  for (let start = 0, index = 0; start < durationSec; start += step, index++) {
    const end = Math.min(start + windowSeconds, durationSec);
    windows.push({ index, start, end });
    if (end >= durationSec) break;
  }
  return windows;
}

function segmentsInRange(
  transcript: Transcript,
  start: number,
  end: number
): TranscriptSegment[] {
  return transcript.segments.filter(
    (seg) => seg.end >= start && seg.start <= end
  );
}

function formatSegmentsForPrompt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "(sem fala transcrita nesta janela)";
  return segments
    .map(
      (seg) =>
        `[${seg.start.toFixed(1)}-${seg.end.toFixed(1)}] ${seg.text.trim()}`
    )
    .join("\n");
}

function snippetForMoment(
  transcript: Transcript,
  start: number,
  end: number
): string {
  return formatSegmentsForPrompt(segmentsInRange(transcript, start, end));
}

function buildWindowPrompt(window: WindowSpec, body: string): string {
  return [
    `Trecho de transcrição de uma live de jogo (janela ${window.index + 1}):`,
    `intervalo_da_janela: ${window.start.toFixed(1)}s → ${window.end.toFixed(1)}s`,
    "",
    body,
    "",
    "Desse trecho de transcrição de uma live de jogo, existe algum momento que poderia virar",
    "um clipe de TikTok — engraçado, tenso, virada inesperada, reação forte, história bem contada,",
    "sarcasmo, briguinha, ou qualquer coisa que prenderia a atenção de alguém que não estava",
    "assistindo a live?",
    "",
    "Critério de qualidade (obrigatório ao avaliar):",
    "- Não conte como forte uma frase só porque menciona jogo, morte, ou brincadeira comum entre",
    "  amigos — isso é o dia a dia normal de qualquer live. Baixe a nota nesses casos.",
    "- Só dê nota alta se a reação, o timing, ou o conteúdo genuinamente surpreenderia ou",
    "  divertiria alguém de fora.",
    "",
    "Para CADA momento que você considerar (mesmo os medianos), dê uma nota honesta de 1 a 10:",
    "- 1 = fala comum sem graça nenhuma",
    "- 5 = ok, mas não prende um estranho",
    "- 7+ = realmente vale clipe",
    "- 10 = piada/reação genuinamente hilária ou tensa que prenderia um estranho no TikTok em segundos",
    "",
    "IMPORTANTE: retorne TODOS os momentos que você avaliaria (com a nota real), inclusive os com",
    "nota baixa/média (3–6). O filtro de corte acontece depois, fora do seu prompt — eu preciso",
    "ver a distribuição completa de notas. Não invente momento do nada; se a janela não tem nada",
    "nem medianamente notável, retorne lista vazia.",
    "",
    "Para cada momento: start/end aproximado (timestamps do trecho), título curto, reason, score.",
    "",
    "Responda APENAS com JSON válido, sem markdown, neste formato:",
    '{ "moments": [ { "start": 0, "end": 0, "title": "", "reason": "", "score": 0 } ] }',
  ].join("\n");
}

function parseMoments(
  raw: string,
  window: WindowSpec
): Array<{
  start: number;
  end: number;
  title: string;
  reason: string;
  score: number;
}> {
  try {
    const parsed = JSON.parse(stripCodeFences(raw)) as {
      moments?: Array<{
        start?: unknown;
        end?: unknown;
        title?: unknown;
        reason?: unknown;
        score?: unknown;
      }>;
    };
    if (!parsed.moments || !Array.isArray(parsed.moments)) {
      throw new Error("JSON sem array moments");
    }
    return parsed.moments
      .map((m) => ({
        start: Number(m.start),
        end: Number(m.end),
        title: String(m.title ?? ""),
        reason: String(m.reason ?? ""),
        score: Number(m.score),
      }))
      .filter(
        (m) =>
          Number.isFinite(m.start) &&
          Number.isFinite(m.end) &&
          m.end > m.start &&
          Number.isFinite(m.score) &&
          m.score >= 1 &&
          m.score <= 10
      )
      .map((m) => ({
        // Clamp to window bounds (model can drift slightly)
        start: Math.max(window.start, Math.min(m.start, window.end)),
        end: Math.max(window.start, Math.min(m.end, window.end)),
        title: m.title,
        reason: m.reason,
        score: Math.round(m.score),
      }))
      .filter((m) => m.end > m.start);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse semantic scan JSON (window ${window.index}): ${message}\nRaw: ${raw}`
    );
  }
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Merge near-duplicate moments from overlapping windows (keep higher score). */
function dedupeMoments(moments: SemanticMoment[]): SemanticMoment[] {
  const sorted = [...moments].sort((a, b) => a.start - b.start);
  const out: SemanticMoment[] = [];
  for (const m of sorted) {
    const prev = out[out.length - 1];
    if (prev && rangesOverlap(prev.start, prev.end, m.start, m.end)) {
      if (m.score > prev.score || (m.score === prev.score && m.end - m.start > prev.end - prev.start)) {
        out[out.length - 1] = m;
      }
      continue;
    }
    out.push(m);
  }
  return out;
}

export async function runSemanticScan(
  vodId: string,
  options?: {
    windowSeconds?: number;
    overlapSeconds?: number;
    /** Overrides SEMANTIC_SCAN_MIN_SCORE / default 7 for this run. */
    minScore?: number;
    onWindow?: (info: {
      index: number;
      total: number;
      start: number;
      end: number;
      momentCount: number;
    }) => void;
  }
): Promise<SemanticScanResult> {
  const windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const overlapSeconds = options?.overlapSeconds ?? DEFAULT_OVERLAP_SECONDS;
  const minScore = resolveMinMomentScore(options?.minScore);

  const vodDir = path.join(getDataDir(), vodId);
  const transcriptPath = path.join(vodDir, "transcript.json");
  const semanticPath = path.join(vodDir, "semantic_candidates.json");

  const transcriptRaw = await fs.readFile(transcriptPath, "utf-8");
  const transcript = JSON.parse(transcriptRaw) as Transcript;

  let metaDuration: number | undefined;
  try {
    const metaRaw = await fs.readFile(path.join(vodDir, "meta.json"), "utf-8");
    const meta = JSON.parse(metaRaw) as { duration?: number | null };
    if (typeof meta.duration === "number") metaDuration = meta.duration;
  } catch {
    // optional
  }

  const durationSec = transcriptDurationSec(transcript, metaDuration);
  if (!(durationSec > 0)) {
    throw new Error(`Cannot determine transcript duration for vodId=${vodId}`);
  }

  const windows = buildWindows(durationSec, windowSeconds, overlapSeconds);
  const client = new Anthropic({ apiKey: getApiKey() });

  let inputTokens = 0;
  let outputTokens = 0;
  const collected: SemanticMoment[] = [];

  for (const window of windows) {
    const segs = segmentsInRange(transcript, window.start, window.end);
    const body = formatSegmentsForPrompt(segs);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        "Você é um editor de clipes de lives da Twitch. Avalie momentos com notas honestas de 1 a 10 (inclua medianos com nota baixa). Seja exigente nas notas altas: dia a dia de live (falar de jogo, morte, zoação comum) deve ficar em nota baixa. Responda APENAS com JSON válido, sem markdown.",
      messages: [{ role: "user", content: buildWindowPrompt(window, body) }],
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(
        `Claude semantic scan had no text content (window ${window.index})`
      );
    }

    const parsed = parseMoments(textBlock.text, window);
    for (const m of parsed) {
      collected.push({
        start: m.start,
        end: m.end,
        title: m.title,
        reason: m.reason,
        score: m.score,
        windowIndex: window.index,
        windowStart: window.start,
        windowEnd: window.end,
        transcriptSnippet: snippetForMoment(transcript, m.start, m.end),
      });
    }

    options?.onWindow?.({
      index: window.index,
      total: windows.length,
      start: window.start,
      end: window.end,
      momentCount: parsed.length,
    });
  }

  const scoredMoments = dedupeMoments(collected).sort(
    (a, b) => b.score - a.score || a.start - b.start
  );
  const candidates = scoredMoments.filter((m) => m.score >= minScore);
  const usage = {
    inputTokens,
    outputTokens,
    estimatedCostUsd: Number(
      estimateCostUsd(inputTokens, outputTokens).toFixed(4)
    ),
  };

  const payload = {
    vodId,
    model: MODEL,
    windowSeconds,
    overlapSeconds,
    windowCount: windows.length,
    durationSec,
    minScore,
    scoredMoments,
    candidates,
    usage,
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(semanticPath, JSON.stringify(payload, null, 2), "utf-8");

  return {
    vodId,
    model: MODEL,
    windowSeconds,
    overlapSeconds,
    windowCount: windows.length,
    durationSec,
    minScore,
    scoredMoments,
    candidates,
    usage,
    semanticPath,
  };
}
