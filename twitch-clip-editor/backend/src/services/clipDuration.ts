/**
 * Clip duration is always relative to the user-marked interval (contract §3).
 * Preview files may drift from marked duration when encoded imprecisely — never
 * expand the edit timeline beyond what the user marked.
 */
export type ResolvedClipDuration = {
  /** Authoritative duration for timeline, export caps, and effect placement. */
  clipDuration: number;
  /** True when the preview file is shorter than the marked interval. */
  previewShorterThanMarked: boolean;
};

const SHORTER_TOLERANCE_SEC = 0.05;

/** Max |previewDuration − markedDuration| before trimPreview is forced. */
export const PREVIEW_DURATION_TOLERANCE_SEC = 0.12;

export function resolveMarkedClipDuration(
  markedDuration: number,
  probedDuration: number | null
): ResolvedClipDuration {
  const marked = Math.max(0.1, markedDuration);
  const probed =
    probedDuration != null && probedDuration > 0 ? probedDuration : marked;

  if (probed + SHORTER_TOLERANCE_SEC < marked) {
    return {
      clipDuration: probed,
      previewShorterThanMarked: true,
    };
  }

  return {
    clipDuration: marked,
    previewShorterThanMarked: false,
  };
}

/** Append preview input capped to the marked clip duration. */
export function pushCappedPreviewInput(
  args: string[],
  previewPath: string,
  clipDuration: number,
  offsetSec = 0
): void {
  const dur = Math.max(0.1, clipDuration);
  if (offsetSec > 0.001) {
    args.push("-ss", String(Number(offsetSec.toFixed(6))));
  }
  args.push(
    "-i",
    previewPath,
    "-t",
    String(Number(dur.toFixed(6)))
  );
}
