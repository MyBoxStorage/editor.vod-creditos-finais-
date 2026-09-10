/**
 * Map hook range on composed timeline → VOD source slices (same scene).
 */

export type TimelineSegment = {
  vodStart: number;
  duration: number;
  timelineStart: number;
};

export type HookSourceSlice = {
  segmentIndex: number;
  vodStart: number;
  duration: number;
};

/** Resolve hook [hookStart, hookEnd) on content timeline into source slices. */
export function resolveHookSourceSlices(
  segments: TimelineSegment[],
  hookStart: number,
  hookEnd: number
): HookSourceSlice[] {
  const slices: HookSourceSlice[] = [];
  const h0 = Math.min(hookStart, hookEnd);
  const h1 = Math.max(hookStart, hookEnd);
  if (!(h1 > h0)) return slices;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segEnd = seg.timelineStart + seg.duration;
    const overlapStart = Math.max(h0, seg.timelineStart);
    const overlapEnd = Math.min(h1, segEnd);
    if (overlapEnd <= overlapStart + 0.001) continue;
    const relStart = overlapStart - seg.timelineStart;
    slices.push({
      segmentIndex: i,
      vodStart: seg.vodStart + relStart,
      duration: overlapEnd - overlapStart,
    });
  }
  return slices;
}

export type ResolvedHook = {
  slices: HookSourceSlice[];
  durationSec: number;
};

export function resolveHookFromTimeline(
  segments: TimelineSegment[],
  hookStartSec: number,
  hookEndSec: number
): ResolvedHook | null {
  const slices = resolveHookSourceSlices(
    segments,
    hookStartSec,
    hookEndSec
  );
  if (!slices.length) return null;
  const durationSec = slices.reduce((a, s) => a + s.duration, 0);
  return { durationSec: Number(durationSec.toFixed(3)), slices };
}
