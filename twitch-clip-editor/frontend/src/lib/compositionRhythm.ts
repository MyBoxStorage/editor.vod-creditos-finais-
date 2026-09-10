import type { ClipSegment } from "./api";

type SegmentView = {
  durationSec: number;
  timelineStart: number;
  clipSegment: ClipSegment;
};

export type RhythmStaleSpan = {
  startSec: number;
  endSec: number;
  durationSec: number;
  segmentIndex: number;
};

export type RhythmMetrics = {
  averageGapSec: number | null;
  staleSpans: RhythmStaleSpan[];
  visualChangeCount: number;
};

function presetStartTimes(segment: ClipSegment, durationSec: number): number[] {
  const apps = segment.presetApplicationsJson;
  if (!Array.isArray(apps)) return [];
  const times: number[] = [];
  for (const raw of apps) {
    if (!raw || typeof raw !== "object") continue;
    const start = (raw as { effectStart?: number }).effectStart;
    if (typeof start !== "number" || !(start >= 0)) continue;
    if (start < durationSec - 0.05) times.push(start);
  }
  return times;
}

/** Visual change times: joins + moment preset starts (contract §20.4). */
export function computeRhythmMetrics(
  segments: SegmentView[],
  joinTimes: number[]
): RhythmMetrics {
  if (segments.length === 0) {
    return { averageGapSec: null, staleSpans: [], visualChangeCount: 0 };
  }

  const changes = new Set<number>([0]);
  for (const t of joinTimes) changes.add(Number(t.toFixed(3)));
  for (const seg of segments) {
    for (const rel of presetStartTimes(seg.clipSegment, seg.durationSec)) {
      changes.add(Number((seg.timelineStart + rel).toFixed(3)));
    }
  }

  const sorted = [...changes].sort((a, b) => a - b);
  const totalDuration =
    segments[segments.length - 1].timelineStart +
    segments[segments.length - 1].durationSec;
  if (!sorted.includes(Number(totalDuration.toFixed(3)))) {
    sorted.push(Number(totalDuration.toFixed(3)));
  }

  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    gaps.push(sorted[i + 1] - sorted[i]);
  }
  const averageGapSec =
    gaps.length > 0
      ? Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2))
      : null;

  const staleSpans: RhythmStaleSpan[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    const gap = end - start;
    if (gap <= 4) continue;
    let segmentIndex = 0;
    for (let si = 0; si < segments.length; si++) {
      const s = segments[si];
      if (start >= s.timelineStart && start < s.timelineStart + s.durationSec) {
        segmentIndex = si;
        break;
      }
    }
    staleSpans.push({
      startSec: start,
      endSec: end,
      durationSec: Number(gap.toFixed(2)),
      segmentIndex,
    });
  }

  return {
    averageGapSec,
    staleSpans,
    visualChangeCount: Math.max(0, sorted.length - 1),
  };
}
