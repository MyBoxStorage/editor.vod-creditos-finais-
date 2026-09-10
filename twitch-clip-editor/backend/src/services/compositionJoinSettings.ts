/**
 * Join settings for camada 3 — audio continuity + optional video transitions (contract §20).
 */

export type JoinAudioMode = "cross" | "j-cut" | "l-cut" | "hard";

export type JoinVideoTransition = "cut" | "fade" | "dissolve";

export type JoinSetting = {
  /** Overlap in seconds (default applied when omitted). */
  overlapSec?: number;
  audioMode?: JoinAudioMode;
  videoTransition?: JoinVideoTransition;
  /** Video transition duration in seconds (max 0.4). */
  videoTransitionSec?: number;
};

export type CompositionJoinSettings = {
  /** Default overlap for new joins (contract: 0.2s). */
  defaultOverlapSec?: number;
  /** Default audio mode (contract: cross). */
  defaultAudioMode?: JoinAudioMode;
  joins?: JoinSetting[];
};

export type ResolvedJoin = {
  joinIndex: number;
  /** Composed timeline time at the cut (start of segment joinIndex+1). */
  joinTimeSec: number;
  audioMode: JoinAudioMode;
  overlapSec: number;
  /** Overlap after clamping to available source material. */
  effectiveOverlapSec: number;
  videoTransition: JoinVideoTransition;
  videoTransitionSec: number;
  warnings: string[];
};

export type SegmentSourceBounds = {
  vodStart: number;
  vodEnd: number;
  materialStart: number;
  materialEnd: number;
};

export const DEFAULT_JOIN_OVERLAP_SEC = 0.2;
export const MAX_JOIN_OVERLAP_SEC = 2;
export const MAX_VIDEO_TRANSITION_SEC = 0.4;

export const DEFAULT_COMPOSITION_JOIN_SETTINGS: CompositionJoinSettings = {
  defaultOverlapSec: DEFAULT_JOIN_OVERLAP_SEC,
  defaultAudioMode: "cross",
  joins: [],
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

function clampOverlap(n: number): number {
  return Math.min(MAX_JOIN_OVERLAP_SEC, Math.max(0, Number(n.toFixed(3))));
}

/** How much source material exists before/after a segment trim window. */
export function sourceMaterialMargins(
  bounds: SegmentSourceBounds,
  vodDuration: number
): { before: number; after: number } {
  const before = Math.max(0, bounds.vodStart - bounds.materialStart);
  const after = Math.max(
    0,
    Math.min(bounds.materialEnd, vodDuration) - bounds.vodEnd
  );
  return { before, after };
}

/**
 * Resolve per-join settings with material clamping (never exceed available source).
 */
export function resolveJoinSettings(
  settings: CompositionJoinSettings,
  segmentBounds: SegmentSourceBounds[],
  segmentDurations: number[]
): ResolvedJoin[] {
  const n = segmentDurations.length;
  if (n < 2) return [];

  const defaultOverlap = clampOverlap(
    settings.defaultOverlapSec ?? DEFAULT_JOIN_OVERLAP_SEC
  );
  const defaultMode = settings.defaultAudioMode ?? "cross";
  const joinsRaw = settings.joins ?? [];

  const resolved: ResolvedJoin[] = [];
  let timeline = 0;

  for (let j = 0; j < n - 1; j++) {
    timeline += segmentDurations[j];
    const row = joinsRaw[j] ?? {};
    const before = segmentBounds[j];
    const after = segmentBounds[j + 1];
    const marginsBefore = sourceMaterialMargins(before, Number.MAX_SAFE_INTEGER);
    const marginsAfter = sourceMaterialMargins(after, Number.MAX_SAFE_INTEGER);

    const audioMode = row.audioMode ?? defaultMode;
    let overlap = clampOverlap(row.overlapSec ?? defaultOverlap);
    const warnings: string[] = [];

    let maxOverlap = overlap;
    if (audioMode === "j-cut" || audioMode === "cross") {
      maxOverlap = Math.min(maxOverlap, marginsAfter.before);
      if (maxOverlap < overlap - 0.001) {
        warnings.push(
          `Emenda ${j + 1}: sobreposição reduzida para ${maxOverlap.toFixed(2)}s — pouco material antes do trecho ${j + 2}.`
        );
      }
    }
    if (audioMode === "l-cut" || audioMode === "cross") {
      maxOverlap = Math.min(maxOverlap, marginsBefore.after);
      if (maxOverlap < overlap - 0.001 && !warnings.length) {
        warnings.push(
          `Emenda ${j + 1}: sobreposição reduzida para ${maxOverlap.toFixed(2)}s — pouco material após o trecho ${j + 1}.`
        );
      }
    }
    if (audioMode === "hard") {
      maxOverlap = 0;
    }

    overlap = clampOverlap(maxOverlap);

    let videoTransition = row.videoTransition ?? "cut";
    let videoTransitionSec = Math.max(
      0,
      row.videoTransitionSec ?? (videoTransition === "cut" ? 0 : 0.2)
    );
    if (videoTransitionSec > MAX_VIDEO_TRANSITION_SEC + 0.001) {
      warnings.push(
        `Emenda ${j + 1}: transição de vídeo limitada a ${MAX_VIDEO_TRANSITION_SEC}s — acima disso prejudica o ritmo.`
      );
      videoTransitionSec = MAX_VIDEO_TRANSITION_SEC;
    }
    if (videoTransition === "cut") {
      videoTransitionSec = 0;
    } else {
      videoTransitionSec = Math.min(
        videoTransitionSec,
        segmentDurations[j] * 0.45,
        segmentDurations[j + 1] * 0.45,
        MAX_VIDEO_TRANSITION_SEC
      );
    }

    resolved.push({
      joinIndex: j,
      joinTimeSec: Number(timeline.toFixed(3)),
      audioMode,
      overlapSec: row.overlapSec ?? defaultOverlap,
      effectiveOverlapSec: overlap,
      videoTransition,
      videoTransitionSec: Number(videoTransitionSec.toFixed(3)),
      warnings,
    });
  }

  return resolved;
}

/** Audio pad before/after each segment for join overlap material from source. */
export function segmentAudioPads(
  segmentIndex: number,
  resolvedJoins: ResolvedJoin[]
): { padBefore: number; padAfter: number } {
  let padBefore = 0;
  let padAfter = 0;
  if (segmentIndex > 0) {
    const prev = resolvedJoins[segmentIndex - 1];
    if (prev) {
      const o = prev.effectiveOverlapSec;
      if (prev.audioMode === "j-cut" || prev.audioMode === "cross") {
        padBefore = o;
      }
      if (prev.audioMode === "l-cut" || prev.audioMode === "cross") {
        padAfter = Math.max(padAfter, o);
      }
    }
  }
  if (segmentIndex < resolvedJoins.length) {
    const next = resolvedJoins[segmentIndex];
    if (next) {
      const o = next.effectiveOverlapSec;
      if (next.audioMode === "l-cut" || next.audioMode === "cross") {
        padAfter = Math.max(padAfter, o);
      }
    }
  }
  return { padBefore, padAfter };
}
