export const PREVIEW_PREPARING_MESSAGE =
  "O trecho ainda está sendo preparado, tente novamente em instantes.";

/** Map ffmpeg / incomplete MP4 errors to a user-facing message. */
export function humanizePreviewFileError(message: string): string {
  const m = message.trim();
  if (!m) return PREVIEW_PREPARING_MESSAGE;
  if (
    /moov atom not found/i.test(m) ||
    /Invalid data found when processing input/i.test(m) ||
    /Error opening input file.*previews[/\\]/i.test(m) ||
    /Error splitting the input into NAL units/i.test(m) ||
    /Decode error rate/i.test(m) ||
    /ffmpeg exited with code/i.test(m)
  ) {
    return PREVIEW_PREPARING_MESSAGE;
  }
  return m;
}

const API_ERROR_TRANSLATIONS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /wastedInsert requires/i,
    message:
      "O efeito Wasted precisa de pelo menos 0,5 s de duração no trecho.",
  },
  {
    pattern: /Wasted effectDuration must be/i,
    message: "A duração do Wasted deve ser de pelo menos 0,5 s.",
  },
  {
    pattern: /Wasted requires effectStart/i,
    message: "O Wasted precisa de um ponto de início válido no trecho.",
  },
  {
    pattern: /Preset application duration must be/i,
    message:
      "Cada aplicação de preset precisa de pelo menos 0,5 s de duração.",
  },
  {
    pattern: /presetApplications entries must include/i,
    message:
      "Cada aplicação de preset precisa de tipo, início, fim e intensidade.",
  },
  {
    pattern: /effectStart and effectEnd must be numbers with end > start/i,
    message: "O fim do efeito precisa ser depois do início.",
  },
  {
    pattern: /end must be greater than start/i,
    message: "O fim do trecho precisa ser depois do início.",
  },
  {
    pattern: /windowStart and windowEnd must be numbers with end > start/i,
    message: "A janela de render precisa de início e fim válidos.",
  },
  {
    pattern: /speed must be/i,
    message: "A velocidade precisa ser um número maior que zero.",
  },
  {
    pattern: /useSubtitles must be a boolean/i,
    message: "A opção de legendas está em formato inválido.",
  },
  {
    pattern: /Unknown emotion preset/i,
    message: "Preset de emoção desconhecido.",
  },
  {
    pattern: /Unknown layout preset/i,
    message: "Layout de exportação desconhecido.",
  },
  {
    pattern: /Invalid quality/i,
    message: "Qualidade de exportação inválida.",
  },
  {
    pattern: /layoutPresetId is required/i,
    message: "Selecione um layout antes de renderizar.",
  },
  {
    pattern: /Body must include useSubtitles/i,
    message: "Faltou informar se as legendas entram no vídeo.",
  },
];

/** Translate technical backend errors before showing them in the UI. */
export function humanizeApiError(message: string): string {
  const m = message.trim();
  if (!m) return m;
  for (const { pattern, message: translated } of API_ERROR_TRANSLATIONS) {
    if (pattern.test(m)) return translated;
  }
  return humanizePreviewFileError(m);
}
