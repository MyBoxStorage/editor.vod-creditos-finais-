/**
 * Closing / outro settings — camada 3 C4.
 */

export type CompositionClosingSettings = {
  enabled?: boolean;
  libraryItemId?: string;
  /** Display duration on timeline (default 1.5s). */
  durationSec?: number;
  /** Linear fade-in at start (reuse image sprint curve). */
  fadeIn?: boolean;
};

export const DEFAULT_CLOSING_DURATION_SEC = 1.5;
export const DEFAULT_FADE_IN_SEC = 0.3;

export const DEFAULT_COMPOSITION_CLOSING_SETTINGS: CompositionClosingSettings =
  {
    enabled: false,
    durationSec: DEFAULT_CLOSING_DURATION_SEC,
    fadeIn: true,
  };

export function parseCompositionClosingSettings(
  raw: unknown
): CompositionClosingSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_COMPOSITION_CLOSING_SETTINGS };
  }
  const o = raw as CompositionClosingSettings;
  return {
    enabled: o.enabled ?? false,
    libraryItemId:
      typeof o.libraryItemId === "string" ? o.libraryItemId : undefined,
    durationSec:
      typeof o.durationSec === "number"
        ? o.durationSec
        : DEFAULT_CLOSING_DURATION_SEC,
    fadeIn: o.fadeIn ?? true,
  };
}

export function closingDurationSec(
  settings: CompositionClosingSettings
): number {
  if (!settings.enabled || !settings.libraryItemId) return 0;
  return Math.max(0.1, settings.durationSec ?? DEFAULT_CLOSING_DURATION_SEC);
}

export function isClosingActive(settings: CompositionClosingSettings): boolean {
  return closingDurationSec(settings) > 0;
}
