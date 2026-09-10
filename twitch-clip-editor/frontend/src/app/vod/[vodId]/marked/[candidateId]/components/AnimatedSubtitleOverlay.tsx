"use client";

import type { ClipTranscript } from "../../../../../../lib/api";
import {
  getSubtitlePreviewFrame,
  type SubtitleSettings,
  type SubtitleWordFrame,
} from "../../../../../../lib/animatedSubtitle";

type AnimatedSubtitleOverlayProps = {
  transcript: ClipTranscript | null;
  clipRelativeTime: number;
  settings?: SubtitleSettings;
};

export function AnimatedSubtitleOverlay({
  transcript,
  clipRelativeTime,
  settings,
}: AnimatedSubtitleOverlayProps) {
  const frame = getSubtitlePreviewFrame(transcript, clipRelativeTime, settings);
  if (!frame || frame.words.length === 0) return null;

  const isClassic = frame.style === "classic";
  const scale =
    frame.style === "one_at_a_time" && frame.words.some((w) => w.active)
      ? 1.08
      : frame.style === "block_highlight" && frame.words.some((w) => w.active)
        ? 1.05
        : 1;

  return (
    <div
      className="pointer-events-none absolute left-[10%] right-[10%] text-center leading-tight"
      style={{
        top: `${frame.positionPercent}%`,
        transform: `translateY(-50%) scale(${scale})`,
        fontSize: `${Math.max(11, frame.fontSize * 0.15)}px`,
        textShadow: `0 0 ${frame.outlineWidth}px #000, 0 0 ${frame.outlineWidth}px #000`,
      }}
    >
      {isClassic ? (
        <span className="font-bold text-white">{frame.words[0]?.text}</span>
      ) : (
        <span className="font-bold">
          {frame.words.map((w: SubtitleWordFrame, i: number) => {
            const color = w.customHighlight
              ? frame.highlightColor
              : w.active
                ? frame.highlightColor
                : "#FFFFFF";
            return (
              <span
                key={`${i}-${w.text}`}
                style={{
                  color,
                  opacity: w.active || w.customHighlight ? 1 : 0.92,
                  transition: "color 80ms ease, transform 120ms ease",
                  display: "inline-block",
                  marginRight: "0.25em",
                  transform:
                    w.active && frame.style === "one_at_a_time"
                      ? "scale(1.06)"
                      : undefined,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}
