/**
 * Pure viewport math for Layer 1 VOD navigation (CONTRATO §16).
 * Viewport is presentation-only; never mutates trecho/selection data.
 */

export const DRAG_SHIFT_SENSITIVITY = 0.25;

export type ZoomLevel = "full" | "10m" | "1m" | "10s";

export const ZOOM_LEVELS: ZoomLevel[] = ["full", "10m", "1m", "10s"];

export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  full: "gravação inteira",
  "10m": "10 minutos",
  "1m": "1 minuto",
  "10s": "10 segundos",
};

export const ZOOM_SPAN_SEC: Record<Exclude<ZoomLevel, "full">, number> = {
  "10m": 600,
  "1m": 60,
  "10s": 10,
};

export type NavigationViewport = {
  windowStartSec: number;
  pxPerSec: number;
  windowSpanSec: number;
};

export type DragAnchor = {
  pointerX: number;
  timeSec: number;
  pxPerSec: number;
};

export function zoomSpanSec(
  zoomLevel: ZoomLevel,
  vodDurationSec: number
): number {
  if (zoomLevel === "full") {
    return Math.max(0.1, vodDurationSec);
  }
  return Math.min(ZOOM_SPAN_SEC[zoomLevel], Math.max(0.1, vodDurationSec));
}

export function computeNavigationViewport(
  vodDurationSec: number,
  zoomLevel: ZoomLevel,
  barWidthPx: number,
  windowStartSec: number
): NavigationViewport {
  const windowSpanSec = zoomSpanSec(zoomLevel, vodDurationSec);
  const maxStart = Math.max(0, vodDurationSec - windowSpanSec);
  const clampedStart = Math.max(0, Math.min(windowStartSec, maxStart));
  return {
    windowStartSec: clampedStart,
    windowSpanSec,
    pxPerSec: Math.max(1, barWidthPx) / windowSpanSec,
  };
}

export function windowEndSec(viewport: NavigationViewport): number {
  return viewport.windowStartSec + viewport.windowSpanSec;
}

export function timeToX(timeSec: number, viewport: NavigationViewport): number {
  return (timeSec - viewport.windowStartSec) * viewport.pxPerSec;
}

export function xToTime(xPx: number, viewport: NavigationViewport): number {
  return viewport.windowStartSec + xPx / viewport.pxPerSec;
}

export function pctInWindow(
  timeSec: number,
  viewport: NavigationViewport
): number {
  const span = viewport.windowSpanSec;
  if (!(span > 0)) return 0;
  return Math.max(
    0,
    Math.min(100, ((timeSec - viewport.windowStartSec) / span) * 100)
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

export function clampTimeToVod(timeSec: number, vodDurationSec: number): number {
  return Math.max(0, Math.min(vodDurationSec, timeSec));
}

export function chapterSelectionWindow(
  markerTimeSec: number,
  beforeSec: number,
  afterSec: number,
  vodDurationSec: number
): { startSec: number; endSec: number } {
  const startSec = clampTimeToVod(markerTimeSec - beforeSec, vodDurationSec);
  const endSec = clampTimeToVod(markerTimeSec + afterSec, vodDurationSec);
  return { startSec, endSec };
}

export function scrollWindowForPan(
  viewport: NavigationViewport,
  deltaPx: number,
  vodDurationSec: number
): number {
  const deltaSec = deltaPx / viewport.pxPerSec;
  const maxStart = Math.max(0, vodDurationSec - viewport.windowSpanSec);
  return Math.max(0, Math.min(maxStart, viewport.windowStartSec + deltaSec));
}
