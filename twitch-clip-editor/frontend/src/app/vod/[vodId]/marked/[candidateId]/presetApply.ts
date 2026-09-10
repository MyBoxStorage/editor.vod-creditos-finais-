import {
  PRESET_DEFAULT_DURATION,
  type EmotionPresetId,
} from "../../../../../lib/emotionPresets";

export const MIN_PRESET_APPLICATION_SEC = 0.5;

export const PRESET_INSUFFICIENT_SPACE_MESSAGE =
  "não há espaço suficiente aqui — posicione o playhead mais para trás";

export type PresetApplyResult =
  | {
      ok: true;
      effectStart: number;
      effectEnd: number;
      wastedEffectDuration: number;
      defaultDuration: number;
      truncated: boolean;
    }
  | { ok: false; reason: "insufficient_space" };

/**
 * Aplica preset começando no playhead com duração padrão da receita (§7).
 * Se não couber até o fim do trecho, encurta (mín. 0,5 s). Se não couber o mínimo, recusa.
 */
export function applyPresetAtPlayhead(
  presetId: EmotionPresetId,
  playhead: number,
  clipDuration: number
): PresetApplyResult {
  const start = Number(
    Math.max(0, Math.min(playhead, clipDuration)).toFixed(3)
  );
  const defaultDuration = PRESET_DEFAULT_DURATION[presetId];
  const maxDur = Math.max(0, clipDuration - start);

  if (maxDur < MIN_PRESET_APPLICATION_SEC) {
    return { ok: false, reason: "insufficient_space" };
  }

  const dur = Number(
    Math.max(
      MIN_PRESET_APPLICATION_SEC,
      Math.min(defaultDuration, maxDur)
    ).toFixed(3)
  );
  const end = Number((start + dur).toFixed(3));

  if (presetId === "wasted") {
    return {
      ok: true,
      effectStart: start,
      effectEnd: end,
      wastedEffectDuration: dur,
      defaultDuration,
      truncated: dur < defaultDuration - 0.001,
    };
  }

  return {
    ok: true,
    effectStart: start,
    effectEnd: end,
    wastedEffectDuration: defaultDuration,
    defaultDuration,
    truncated: dur < defaultDuration - 0.001,
  };
}
