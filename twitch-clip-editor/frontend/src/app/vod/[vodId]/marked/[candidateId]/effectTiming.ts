import type { ClipEffectInstance } from "../../../../../lib/api";
import type { PresetApplication } from "./presetApplications";
import { applicationEnd, sortApplications } from "./presetApplications";

/** §3 — segundos dentro do arquivo da biblioteca ("parte do efeito"). */
export type SourceFileSeconds = number & { readonly __sourceFile?: unique symbol };

/** §4 — segundos relativos ao início do trecho do clipe ("momento do clipe"). */
export type ClipRelativeSeconds = number & { readonly __clipRelative?: unique symbol };

/** Duração da parte selecionada no arquivo fonte. */
export function sourcePartDurationSeconds(
  sourceTrimStart: number | null | undefined,
  sourceTrimEnd: number | null | undefined
): SourceFileSeconds {
  const start = sourceTrimStart ?? 0;
  const end = sourceTrimEnd ?? start + 1;
  return Math.max(0.05, end - start) as SourceFileSeconds;
}

/** Fim do efeito no referencial do clipe: entrada + duração da parte. */
export function effectClipEndSeconds(
  clipTimestamp: number | null | undefined,
  sourceTrimStart: number | null | undefined,
  sourceTrimEnd: number | null | undefined
): ClipRelativeSeconds {
  const ts = clipTimestamp ?? 0;
  return (ts +
    sourcePartDurationSeconds(sourceTrimStart, sourceTrimEnd)) as ClipRelativeSeconds;
}

export type FaithfulWindowInput = {
  clipDuration: number;
  presetApplications: PresetApplication[];
  appliedEffects: ClipEffectInstance[];
};

const WINDOW_PAD_SECONDS = 1;

/**
 * Janela NVENC para render fiel: span de todas as aplicações ±pad, efeitos ±pad, ou trecho inteiro.
 */
export function computeFaithfulWindow(input: FaithfulWindowInput): {
  start: ClipRelativeSeconds;
  end: ClipRelativeSeconds;
} {
  const fullWindow = {
    start: 0 as ClipRelativeSeconds,
    end: input.clipDuration as ClipRelativeSeconds,
  };

  let window: { start: number; end: number } | null = null;

  if (input.presetApplications.length > 0) {
    const sorted = sortApplications(input.presetApplications);
    const winStart = sorted[0].inicio;
    const winEnd = applicationEnd(sorted[sorted.length - 1]);
    window = {
      start: Math.max(0, winStart - WINDOW_PAD_SECONDS),
      end: Math.min(input.clipDuration, winEnd + WINDOW_PAD_SECONDS),
    };
  } else if (input.appliedEffects.length > 0) {
    let minT = Infinity;
    let maxT = -Infinity;
    for (const inst of input.appliedEffects) {
      const clipTs = inst.clipTimestamp ?? 0;
      const clipEnd = effectClipEndSeconds(
        clipTs,
        inst.sourceTrimStart,
        inst.sourceTrimEnd
      );
      minT = Math.min(minT, clipTs);
      maxT = Math.max(maxT, clipEnd);
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) {
      return fullWindow;
    }
    window = {
      start: Math.max(0, minT - WINDOW_PAD_SECONDS),
      end: Math.min(input.clipDuration, maxT + WINDOW_PAD_SECONDS),
    };
  } else {
    return fullWindow;
  }

  if (!(window.end > window.start)) {
    console.warn(
      "[computeFaithfulWindow] janela inválida (fim <= início); usando trecho inteiro.",
      { input, window }
    );
    return fullWindow;
  }

  return {
    start: window.start as ClipRelativeSeconds,
    end: window.end as ClipRelativeSeconds,
  };
}
