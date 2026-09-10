/** Editor is designed for short clips (~10–60s); warn above 3 min, block above 10 min. */
export const SEGMENT_DURATION_WARN_SEC = 180;
export const SEGMENT_DURATION_MAX_SEC = 600;

export function segmentDurationSec(start: number, end: number): number {
  return end - start;
}

function formatDurationMinutes(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s}s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s}s`;
}

export const SEGMENT_DURATION_BLOCK_MESSAGE = (durationSec: number) =>
  `Trecho muito longo (${formatDurationMinutes(durationSec)}). O editor é feito para cortes de até 10 minutos. Defina um intervalo menor na camada 1 (timeline ou marcação).`;

export const SEGMENT_DURATION_WARN_MESSAGE =
  "Este trecho passa de 3 minutos. O editor foi feito para cortes curtos (10–60 s); ajustar e exportar pode demorar bastante.";

export function isSegmentDurationBlocked(start: number, end: number): boolean {
  return segmentDurationSec(start, end) > SEGMENT_DURATION_MAX_SEC;
}

export function shouldWarnSegmentDuration(start: number, end: number): boolean {
  const dur = segmentDurationSec(start, end);
  return dur > SEGMENT_DURATION_WARN_SEC && dur <= SEGMENT_DURATION_MAX_SEC;
}

export function assertSegmentDurationAllowed(start: number, end: number): void {
  if (!(end > start)) {
    throw new Error("end must be greater than start");
  }
  if (isSegmentDurationBlocked(start, end)) {
    throw new Error(SEGMENT_DURATION_BLOCK_MESSAGE(segmentDurationSec(start, end)));
  }
}
