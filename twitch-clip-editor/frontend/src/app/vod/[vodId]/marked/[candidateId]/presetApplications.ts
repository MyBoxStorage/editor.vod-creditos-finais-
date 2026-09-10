import {
  expandEmotionPreset,
  EMOTION_PRESET_META,
  type EmotionPresetId,
} from "../../../../../lib/emotionPresets";
import type { EffectLibraryItem } from "../../../../../lib/api";
import type { ColorPresetUi, SpeedRampRow, ZoomKeyframeRow } from "./types";
import { applyPresetAtPlayhead, MIN_PRESET_APPLICATION_SEC } from "./presetApply";

export { MIN_PRESET_APPLICATION_SEC };

/** §6 — uma aplicação de preset no trecho. */
export type PresetApplication = {
  id: string;
  presetId: EmotionPresetId;
  inicio: number;
  duracao: number;
  intensidade: number;
  itensBiblioteca: string[];
  /** library item id → clip effect instance id */
  linkedEffectIds: Record<string, string>;
  zoomKeyframes: ZoomKeyframeRow[];
  colorPreset: ColorPresetUi;
  speedRamp: SpeedRampRow[];
};

export type PresetApplicationExport = {
  presetId: EmotionPresetId;
  effectStart: number;
  effectEnd: number;
  effectDuration?: number;
  intensityPercent: number;
  zoomKeyframes?: ZoomKeyframeRow[];
  colorPreset?: ColorPresetUi;
  speedRamp?: SpeedRampRow[];
  colorEffectStart?: number;
  colorEffectEnd?: number;
  colorFadeSeconds?: number;
};

/** Nomes na biblioteca sugeridos por preset (atalho, não vínculo). */
export const PRESET_SUGGESTED_LIBRARY_NAMES: Record<EmotionPresetId, string[]> =
  {
    emphasis: [],
    suspense: [],
    celebration: [],
    surprise: [],
    disappointment: [],
    wasted: ["Wasted CGI", "Wasted"],
  };

export function applicationEnd(app: PresetApplication): number {
  return Number((app.inicio + app.duracao).toFixed(3));
}

export function presetLabel(presetId: EmotionPresetId): string {
  return EMOTION_PRESET_META.find((p) => p.id === presetId)?.label ?? presetId;
}

export function sortApplications(apps: PresetApplication[]): PresetApplication[] {
  return [...apps].sort((a, b) => a.inicio - b.inicio);
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function applicationOverlapsAny(
  candidate: Pick<PresetApplication, "inicio" | "duracao">,
  existing: PresetApplication[],
  exceptId?: string
): boolean {
  const cEnd = candidate.inicio + candidate.duracao;
  for (const app of existing) {
    if (exceptId && app.id === exceptId) continue;
    if (rangesOverlap(candidate.inicio, cEnd, app.inicio, applicationEnd(app))) {
      return true;
    }
  }
  return false;
}

export function createPresetApplication(
  presetId: EmotionPresetId,
  playhead: number,
  clipDuration: number
):
  | { app: PresetApplication; truncated: boolean; rejected?: false }
  | { rejected: true } {
  const placed = applyPresetAtPlayhead(presetId, playhead, clipDuration);
  if (!placed.ok) {
    return { rejected: true };
  }
  const dur =
    presetId === "wasted"
      ? placed.wastedEffectDuration
      : Number((placed.effectEnd - placed.effectStart).toFixed(3));
  return {
    app: {
      id: crypto.randomUUID(),
      presetId,
      inicio: placed.effectStart,
      duracao: dur,
      intensidade: 100,
      itensBiblioteca: [],
      linkedEffectIds: {},
      zoomKeyframes: [],
      colorPreset: "none",
      speedRamp: [],
    },
    truncated: placed.truncated,
  };
}

export type SanitizeApplicationsResult = {
  apps: PresetApplication[];
  removedCount: number;
  fixedCount: number;
};

/** Corrige ou remove aplicações inválidas (< 0,5 s ou fora do trecho). */
export function sanitizePresetApplications(
  apps: PresetApplication[],
  clipDuration: number
): SanitizeApplicationsResult {
  let removedCount = 0;
  let fixedCount = 0;
  const kept: PresetApplication[] = [];

  for (const app of sortApplications(apps)) {
    const inicio = Number(
      Math.max(0, Math.min(app.inicio, clipDuration)).toFixed(3)
    );
    const maxDur = Math.max(0, clipDuration - inicio);
    if (maxDur < MIN_PRESET_APPLICATION_SEC) {
      removedCount += 1;
      continue;
    }
    const dur = Number(
      Math.max(
        MIN_PRESET_APPLICATION_SEC,
        Math.min(app.duracao, maxDur)
      ).toFixed(3)
    );
    if (dur !== app.duracao || inicio !== app.inicio) {
      fixedCount += 1;
    }
    kept.push({ ...app, inicio, duracao: dur });
  }

  return { apps: kept, removedCount, fixedCount };
}

export function clampApplicationTiming(
  inicio: number,
  duracao: number,
  clipDuration: number
): { inicio: number; duracao: number; valid: boolean } {
  const start = Number(
    Math.max(0, Math.min(inicio, clipDuration)).toFixed(3)
  );
  const maxDur = Math.max(0, clipDuration - start);
  if (maxDur < MIN_PRESET_APPLICATION_SEC) {
    return { inicio: start, duracao: 0, valid: false };
  }
  const dur = Number(
    Math.max(
      MIN_PRESET_APPLICATION_SEC,
      Math.min(duracao, maxDur)
    ).toFixed(3)
  );
  return { inicio: start, duracao: dur, valid: true };
}

export function expandApplicationParams(
  app: PresetApplication,
  clipDuration: number
) {
  const effectEnd = applicationEnd(app);
  const expanded = expandEmotionPreset({
    presetId: app.presetId,
    effectStart: app.inicio,
    effectEnd,
    effectDuration: app.presetId === "wasted" ? app.duracao : undefined,
    clipDuration,
    intensityPercent: app.intensidade,
  });
  const zoomKeyframes =
    app.zoomKeyframes.length > 0 ? app.zoomKeyframes : expanded.zoomKeyframes;
  const colorPreset =
    app.colorPreset !== "none"
      ? app.colorPreset
      : (expanded.colorPreset as ColorPresetUi);
  const speedRamp =
    app.speedRamp.length > 0
      ? app.speedRamp
      : (expanded.speedRamp ?? []);
  return {
    expanded,
    zoomKeyframes,
    colorPreset,
    speedRamp,
    effectStart: app.inicio,
    effectEnd,
  };
}

/** Campos legados para export/preview com UMA aplicação (byte-identical). */
export function applicationToLegacyExportFields(
  app: PresetApplication,
  clipDuration: number
): Record<string, unknown> {
  const { zoomKeyframes, colorPreset, speedRamp, effectStart, effectEnd } =
    expandApplicationParams(app, clipDuration);

  if (app.presetId === "wasted") {
    return {
      wastedInsert: {
        insertAtTime: effectStart,
        effectDuration: app.duracao,
        intensityPercent: app.intensidade,
      },
    };
  }

  const out: Record<string, unknown> = {};
  if (zoomKeyframes.length > 0) out.zoomKeyframes = zoomKeyframes;
  if (colorPreset !== "none") {
    out.colorPreset = colorPreset;
    out.colorIntensityPercent = app.intensidade;
    if (effectEnd > effectStart) {
      out.colorEffectStart = effectStart;
      out.colorEffectEnd = effectEnd;
      if (app.presetId === "emphasis" || app.presetId === "surprise") {
        out.colorFadeSeconds = 0;
      }
    }
  }
  if (speedRamp.length > 0) out.speedRamp = speedRamp;
  return out;
}

export function applicationsToExportPayload(
  apps: PresetApplication[],
  clipDuration: number
): PresetApplicationExport[] {
  return sortApplications(apps).map((app) => {
    const { zoomKeyframes, colorPreset, speedRamp, effectStart, effectEnd } =
      expandApplicationParams(app, clipDuration);
    const row: PresetApplicationExport = {
      presetId: app.presetId,
      effectStart,
      effectEnd,
      intensityPercent: app.intensidade,
    };
    if (app.presetId === "wasted") {
      row.effectDuration = app.duracao;
    }
    if (zoomKeyframes.length > 0) row.zoomKeyframes = zoomKeyframes;
    if (colorPreset !== "none") {
      row.colorPreset = colorPreset;
      if (effectEnd > effectStart) {
        row.colorEffectStart = effectStart;
        row.colorEffectEnd = effectEnd;
        if (app.presetId === "emphasis" || app.presetId === "surprise") {
          row.colorFadeSeconds = 0;
        }
      }
    }
    if (speedRamp.length > 0) row.speedRamp = speedRamp;
    return row;
  });
}

export type MergedFastPreview = {
  zoomKeyframes: ZoomKeyframeRow[];
  colorPreset: ColorPresetUi;
  colorIntensityPercent: number;
  colorEffectStart?: number;
  colorEffectEnd?: number;
  speedRamp: SpeedRampRow[];
};

/** Prévia rápida aproximada: mescla todas as aplicações (sem sobreposição). */
export function mergeApplicationsForFastPreview(
  apps: PresetApplication[],
  clipDuration: number,
  playheadT?: number
): MergedFastPreview {
  const sorted = sortApplications(apps);
  const zoomKeyframes: ZoomKeyframeRow[] = [];
  const speedRamp: SpeedRampRow[] = [];
  let colorPreset: ColorPresetUi = "none";
  let colorIntensityPercent = 100;
  let colorEffectStart: number | undefined;
  let colorEffectEnd: number | undefined;

  for (const app of sorted) {
    const p = expandApplicationParams(app, clipDuration);
    zoomKeyframes.push(...p.zoomKeyframes);
    if (p.speedRamp.length > 0) speedRamp.push(...p.speedRamp);
  }

  if (typeof playheadT === "number") {
    const active = sorted.find(
      (a) => playheadT >= a.inicio && playheadT < applicationEnd(a)
    );
    if (active) {
      const p = expandApplicationParams(active, clipDuration);
      colorPreset = p.colorPreset;
      colorIntensityPercent = active.intensidade;
      colorEffectStart = p.effectStart;
      colorEffectEnd = p.effectEnd;
    }
  } else if (sorted.length === 1) {
    const p = expandApplicationParams(sorted[0], clipDuration);
    colorPreset = p.colorPreset;
    colorIntensityPercent = sorted[0].intensidade;
    colorEffectStart = p.effectStart;
    colorEffectEnd = p.effectEnd;
  }

  return {
    zoomKeyframes,
    colorPreset,
    colorIntensityPercent,
    colorEffectStart,
    colorEffectEnd,
    speedRamp,
  };
}

export function resolveSuggestedLibraryItems(
  presetId: EmotionPresetId,
  library: EffectLibraryItem[]
): { suggested: EffectLibraryItem[]; missingSuggested: boolean } {
  const names = PRESET_SUGGESTED_LIBRARY_NAMES[presetId];
  if (!names.length) {
    return { suggested: [], missingSuggested: false };
  }
  const suggested = names
    .map((name) =>
      library.find((item) =>
        item.name.toLowerCase().includes(name.toLowerCase())
      )
    )
    .filter((x): x is EffectLibraryItem => !!x);
  return {
    suggested,
    missingSuggested: suggested.length < names.length,
  };
}

export function sortLibraryForApplication(
  presetId: EmotionPresetId,
  library: EffectLibraryItem[]
): EffectLibraryItem[] {
  const { suggested } = resolveSuggestedLibraryItems(presetId, library);
  const suggestedIds = new Set(suggested.map((s) => s.id));
  const rest = library.filter((item) => !suggestedIds.has(item.id));
  return [...suggested, ...rest];
}
