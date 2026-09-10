/**
 * Pure trim-bar time ↔ pixel math (CONTRATO §16).
 * Fixed scale: bar width always maps to the full material duration.
 */

export const MIN_TRIM_SEGMENT_SEC = 0.5;
export const DRAG_SHIFT_SENSITIVITY = 0.25;

export type VodInterval = {
  startSec: number;
  endSec: number;
};

export type DragAnchor = {
  pointerX: number;
  timeSec: number;
  pxPerSec: number;
};

/** Fixed-scale bar spanning material from barStartSec to barEndSec. */
export type TrimBarLayout = {
  barStartSec: number;
  barEndSec: number;
  pxPerSec: number;
};

export type TrimDisplayTimes = {
  /** Selection bounds relative to material start. */
  selectionStart: number;
  selectionEnd: number;
  selectionDuration: number;
  materialDuration: number;
  /** Material excluded before selection (will be discarded on cut). */
  excludedHead: number;
  /** Material excluded after selection (will be discarded on cut). */
  excludedTail: number;
};

export function intervalDuration(interval: VodInterval): number {
  return Math.max(MIN_TRIM_SEGMENT_SEC, interval.endSec - interval.startSec);
}

export function materialBarBounds(material: VodInterval): {
  barStartSec: number;
  barEndSec: number;
} {
  return {
    barStartSec: material.startSec,
    barEndSec: Math.max(
      material.startSec + MIN_TRIM_SEGMENT_SEC,
      material.endSec
    ),
  };
}

export function selectionDiffers(
  material: VodInterval,
  selection: VodInterval,
  eps = 0.05
): boolean {
  return (
    Math.abs(selection.startSec - material.startSec) > eps ||
    Math.abs(selection.endSec - material.endSec) > eps
  );
}

export function computeTrimBarLayout(
  barStartSec: number,
  barEndSec: number,
  barWidthPx: number
): TrimBarLayout {
  const span = Math.max(MIN_TRIM_SEGMENT_SEC, barEndSec - barStartSec);
  return {
    barStartSec,
    barEndSec,
    pxPerSec: Math.max(1, barWidthPx) / span,
  };
}

export function deriveTrimDisplayTimes(
  material: VodInterval,
  selection: VodInterval
): TrimDisplayTimes {
  const materialOrigin = material.startSec;
  const selectionDuration = selection.endSec - selection.startSec;
  return {
    selectionStart: selection.startSec - materialOrigin,
    selectionEnd: selection.endSec - materialOrigin,
    selectionDuration: Math.max(MIN_TRIM_SEGMENT_SEC, selectionDuration),
    materialDuration: Math.max(MIN_TRIM_SEGMENT_SEC, material.endSec - material.startSec),
    excludedHead: Math.max(0, selection.startSec - material.startSec),
    excludedTail: Math.max(0, material.endSec - selection.endSec),
  };
}

export function pctOnBar(absSec: number, layout: TrimBarLayout): number {
  const span = layout.barEndSec - layout.barStartSec;
  if (!(span > 0)) return 0;
  return Math.max(
    0,
    Math.min(100, ((absSec - layout.barStartSec) / span) * 100)
  );
}

export function dragTimeFromAnchor(
  anchor: DragAnchor,
  currentPointerX: number,
  shiftKey: boolean
): number {
  const scale = shiftKey ? DRAG_SHIFT_SENSITIVITY : 1;
  const deltaPx = (currentPointerX - anchor.pointerX) * scale;
  return anchor.timeSec + deltaPx / anchor.pxPerSec;
}

export function clampStartHandle(
  timeSec: number,
  selection: VodInterval,
  materialStartSec: number
): number {
  return Math.max(
    materialStartSec,
    Math.min(timeSec, selection.endSec - MIN_TRIM_SEGMENT_SEC)
  );
}

export function clampEndHandle(
  timeSec: number,
  selection: VodInterval,
  materialEndSec: number
): number {
  return Math.min(
    materialEndSec,
    Math.max(timeSec, selection.startSec + MIN_TRIM_SEGMENT_SEC)
  );
}

export function roundDisplaySec(sec: number): number {
  return Number(sec.toFixed(1));
}
