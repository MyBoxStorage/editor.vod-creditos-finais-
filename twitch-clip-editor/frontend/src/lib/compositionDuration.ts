import {
  durationWarningLevel,
  formatClipTime,
  type DurationWarningLevel,
} from "./finalizationTime";
import { hookDurationSec } from "./compositionOpeningSettings";
import { closingDurationSec } from "./compositionClosingSettings";
import type { CompositionOpeningSettings } from "./compositionOpeningSettings";
import type { CompositionClosingSettings } from "./compositionClosingSettings";

export type CompositionDurationBreakdown = {
  hookSec: number;
  contentSec: number;
  closingSec: number;
  totalSec: number;
  warnLevel: DurationWarningLevel;
};

export function computeCompositionDuration(input: {
  contentSec: number;
  openingSettings: CompositionOpeningSettings;
  closingSettings: CompositionClosingSettings;
}): CompositionDurationBreakdown {
  const hookSec = hookDurationSec(input.openingSettings);
  const contentSec = input.contentSec;
  const closingSec = closingDurationSec(input.closingSettings);
  const totalSec = hookSec + contentSec + closingSec;
  return {
    hookSec,
    contentSec,
    closingSec,
    totalSec,
    warnLevel: durationWarningLevel(totalSec),
  };
}

export function formatDurationIndicator(b: CompositionDurationBreakdown): string {
  return `hook ${formatClipTime(b.hookSec)} + conteúdo ${formatClipTime(b.contentSec)} + fechamento ${formatClipTime(b.closingSec)} = ${formatClipTime(b.totalSec)}`;
}
