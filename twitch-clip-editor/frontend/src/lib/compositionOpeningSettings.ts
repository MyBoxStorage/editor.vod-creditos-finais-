export type CompositionOpeningMode = "none" | "hook";

export type CompositionOpeningSettings = {
  mode?: CompositionOpeningMode;
  hookEnabled?: boolean;
  hookStartSec?: number;
  hookEndSec?: number;
};

export const MAX_HOOK_SEC = 2;
export const HOOK_RESEARCH_NOTE =
  "Hooks abaixo de 2 segundos têm cerca de 30% mais duração média de visualização; a decisão de continuar acontece no ou antes do primeiro segundo.";

export const DEFAULT_COMPOSITION_OPENING_SETTINGS: CompositionOpeningSettings =
  {
    mode: "none",
    hookEnabled: false,
  };

export function parseCompositionOpeningSettings(
  raw: unknown
): CompositionOpeningSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_COMPOSITION_OPENING_SETTINGS };
  }
  const o = raw as CompositionOpeningSettings;
  return {
    mode: o.mode === "hook" ? "hook" : "none",
    hookEnabled: o.hookEnabled ?? false,
    hookStartSec:
      typeof o.hookStartSec === "number" ? o.hookStartSec : undefined,
    hookEndSec: typeof o.hookEndSec === "number" ? o.hookEndSec : undefined,
  };
}

export function hookDurationSec(settings: CompositionOpeningSettings): number {
  if (
    settings.mode !== "hook" ||
    !settings.hookEnabled ||
    typeof settings.hookStartSec !== "number" ||
    typeof settings.hookEndSec !== "number"
  ) {
    return 0;
  }
  return Math.max(0, settings.hookEndSec - settings.hookStartSec);
}

export function isHookActive(settings: CompositionOpeningSettings): boolean {
  return hookDurationSec(settings) > 0.01;
}

export function normalizeHookRange(
  settings: CompositionOpeningSettings,
  contentDurationSec: number
): { settings: CompositionOpeningSettings; warnings: string[] } {
  const warnings: string[] = [];
  if (settings.mode !== "hook") {
    return { settings, warnings };
  }
  let start = settings.hookStartSec ?? 0;
  let end = settings.hookEndSec ?? start;
  if (end < start) [start, end] = [end, start];
  start = Math.max(0, Math.min(contentDurationSec, start));
  end = Math.max(start, Math.min(contentDurationSec, end));
  const dur = end - start;
  if (dur > MAX_HOOK_SEC + 0.001) {
    warnings.push(
      `Hook acima de ${MAX_HOOK_SEC}s prejudica retenção — ${HOOK_RESEARCH_NOTE}`
    );
  }
  return {
    settings: {
      ...settings,
      hookStartSec: Number(start.toFixed(3)),
      hookEndSec: Number(end.toFixed(3)),
    },
    warnings,
  };
}
