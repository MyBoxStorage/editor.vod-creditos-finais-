export type JoinAudioMode = "cross" | "j-cut" | "l-cut" | "hard";

export type JoinVideoTransition = "cut" | "fade" | "dissolve";

export type JoinSetting = {
  overlapSec?: number;
  audioMode?: JoinAudioMode;
  videoTransition?: JoinVideoTransition;
  videoTransitionSec?: number;
};

export type CompositionJoinSettings = {
  defaultOverlapSec?: number;
  defaultAudioMode?: JoinAudioMode;
  joins?: JoinSetting[];
};

export const DEFAULT_JOIN_OVERLAP_SEC = 0.2;
export const MAX_VIDEO_TRANSITION_SEC = 0.4;

export const DEFAULT_COMPOSITION_JOIN_SETTINGS: CompositionJoinSettings = {
  defaultOverlapSec: DEFAULT_JOIN_OVERLAP_SEC,
  defaultAudioMode: "cross",
  joins: [],
};

export const JOIN_AUDIO_MODE_LABELS: Record<JoinAudioMode, string> = {
  cross: "cruzado",
  "j-cut": "J-cut",
  "l-cut": "L-cut",
  hard: "corte seco",
};

export const JOIN_VIDEO_TRANSITION_LABELS: Record<JoinVideoTransition, string> =
  {
    cut: "corte seco",
    fade: "fade",
    dissolve: "dissolve",
  };

export function parseCompositionJoinSettings(
  raw: unknown
): CompositionJoinSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_COMPOSITION_JOIN_SETTINGS, joins: [] };
  }
  const o = raw as CompositionJoinSettings;
  return {
    defaultOverlapSec:
      typeof o.defaultOverlapSec === "number"
        ? o.defaultOverlapSec
        : DEFAULT_JOIN_OVERLAP_SEC,
    defaultAudioMode: o.defaultAudioMode ?? "cross",
    joins: Array.isArray(o.joins) ? o.joins : [],
  };
}

export function ensureJoinRows(
  settings: CompositionJoinSettings,
  joinCount: number
): CompositionJoinSettings {
  const joins = [...(settings.joins ?? [])];
  while (joins.length < joinCount) joins.push({});
  if (joins.length > joinCount) joins.length = joinCount;
  return { ...settings, joins };
}
