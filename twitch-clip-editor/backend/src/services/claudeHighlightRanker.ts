import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import type { Transcript } from "./transcribeService";
import type { PeakCandidate } from "../pipeline/chatPeakDetector";

const MODEL = "claude-sonnet-4-6";

export type Highlight = {
  start: number;
  end: number;
  reason: string;
  suggestedTitle: string;
};

type CandidatesFile = {
  method: string;
  candidates: PeakCandidate[];
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

function sliceTranscript(
  transcript: Transcript,
  start: number,
  end: number
): string {
  const parts: string[] = [];
  for (const seg of transcript.segments) {
    if (seg.end < start || seg.start > end) continue;
    parts.push(`[${seg.start.toFixed(1)}-${seg.end.toFixed(1)}] ${seg.text}`);
  }
  return parts.join("\n") || "(sem transcrição neste intervalo)";
}

function buildUserPrompt(candidates: PeakCandidate[], transcript: Transcript): string {
  const blocks = candidates.map((c, i) => {
    const transcriptSlice = sliceTranscript(transcript, c.start, c.end);
    const notes =
      c.sampleMessages.length > 0
        ? c.sampleMessages.map((m) => `- ${m}`).join("\n")
        : "(sem notas)";
    const source = c.source ? `source=${c.source}` : "source=unknown";
    return [
      `CANDIDATO #${i + 1} (já identificado como interessante na varredura semântica)`,
      `janela_sugerida: ${c.start} → ${c.end} (score=${c.score.toFixed(3)}, ${source})`,
      `transcricao:`,
      transcriptSlice,
      `notas/sinais:`,
      notes,
    ].join("\n");
  });

  return [
    "Os candidatos abaixo JÁ foram identificados como momentos relevantes por uma varredura semântica",
    "da transcrição (com reforço acústico quando houver overlap). Seu trabalho NÃO é decidir do zero",
    "se algo é interessante — isso já foi feito. Seu trabalho é REFINAR a precisão do corte e o título.",
    "",
    "Escolha os 6 a 10 melhores entre esses candidatos (pode descartar os fracos/redundantes) e refine cada um.",
    "",
    "Regras de CORTE (obrigatórias):",
    "- Corte o \"preparo\" antes do momento de impacto. Inicie o clipe o mais perto possível do gatilho real",
    "  (ex: se a graça foi dita no segundo 38, comece ~37 — NÃO em 30).",
    "- Comece no MÁXIMO 3–5 segundos ANTES do início do momento forte daquele candidato",
    "  (nunca 10, 15 ou mais segundos de margem só por 'segurança').",
    "- Termine no MÁXIMO 3–5 segundos DEPOIS do fim do evento, a menos que a transcrição mostre claramente",
    "  continuação relevante da fala/reação logo em seguida — cada segundo extra precisa ter fala útil,",
    "  não silêncio nem tela de loading.",
    "- Se a transcrição nos primeiros/últimos segundos da janela não tiver fala relevante (silêncio,",
    "  loading, transição de partida), CORTE essa parte fora. Clipe curto (8–12s) é aceitável se o momento for bom.",
    "- Prefira duração total entre 8 e 45 segundos conforme o conteúdo pedir (ideal ~10–20s). Evite > 45s.",
    "- Pode ajustar start/end para não cortar no meio de uma frase, mas priorize corte seco no pico",
    "  sobre 'contexto longo' antes da ação.",
    "",
    "Exemplo NEGATIVO (não faça):",
    "- Não inclua tempo de carregamento de partida, tela preta, ou introdução sem fala relevante só para",
    "  'dar contexto' — prefira um corte mais seco e direto ao ponto.",
    "",
    "Título:",
    "- suggestedTitle deve ser curto e chamativo, pensado para TikTok (gancho), não descrição neutra.",
    "",
    "Para cada highlight: refine start/end, motive em 1 frase (reason), e dê o título.",
    "",
    "Responda APENAS com JSON válido, sem markdown, neste formato:",
    '{ "highlights": [ { "start": 0, "end": 0, "reason": "", "suggestedTitle": "" } ] }',
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseHighlights(raw: string): Highlight[] {
  try {
    const parsed = JSON.parse(stripCodeFences(raw)) as {
      highlights?: Highlight[];
    };
    if (!parsed.highlights || !Array.isArray(parsed.highlights)) {
      throw new Error("JSON sem array highlights");
    }
    return parsed.highlights.map((h) => ({
      start: Number(h.start),
      end: Number(h.end),
      reason: String(h.reason ?? ""),
      suggestedTitle: String(h.suggestedTitle ?? ""),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse Claude highlights JSON: ${message}\nRaw: ${raw}`);
  }
}

export async function rankHighlights(vodId: string): Promise<{
  vodId: string;
  highlights: Highlight[];
  highlightsPath: string;
}> {
  const vodDir = path.join(getDataDir(), vodId);
  const candidatesPath = path.join(vodDir, "candidates.json");
  const transcriptPath = path.join(vodDir, "transcript.json");
  const highlightsPath = path.join(vodDir, "highlights.json");

  const candidatesRaw = await fs.readFile(candidatesPath, "utf-8");
  const transcriptRaw = await fs.readFile(transcriptPath, "utf-8");
  const candidatesFile = JSON.parse(candidatesRaw) as CandidatesFile;
  const transcript = JSON.parse(transcriptRaw) as Transcript;

  if (!candidatesFile.candidates?.length) {
    throw new Error(`No candidates found for vodId=${vodId}`);
  }

  const client = new Anthropic({ apiKey: getApiKey() });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system:
      "Você é um editor de clipes de lives da Twitch. Responda APENAS com JSON válido, sem markdown e sem texto fora do JSON.",
    messages: [
      {
        role: "user",
        content: buildUserPrompt(candidatesFile.candidates, transcript),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response had no text content");
  }

  const highlights = parseHighlights(textBlock.text);
  await fs.writeFile(
    highlightsPath,
    JSON.stringify({ highlights }, null, 2),
    "utf-8"
  );

  return { vodId, highlights, highlightsPath };
}
