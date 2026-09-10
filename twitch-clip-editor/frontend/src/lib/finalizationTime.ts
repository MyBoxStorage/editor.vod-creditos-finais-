/** Contract §3 — m:ss,d display for camada 3. */
export function formatClipTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const dec = Math.round((sec - whole) * 10);
  return `${m}:${String(whole).padStart(2, "0")},${dec}`;
}

export const DURATION_SOFT_WARN_SEC = 22;
export const DURATION_STRONG_WARN_SEC = 30;

export type DurationWarningLevel = "ok" | "soft" | "strong";

export function durationWarningLevel(totalSec: number): DurationWarningLevel {
  if (totalSec > DURATION_STRONG_WARN_SEC) return "strong";
  if (totalSec > DURATION_SOFT_WARN_SEC) return "soft";
  return "ok";
}
