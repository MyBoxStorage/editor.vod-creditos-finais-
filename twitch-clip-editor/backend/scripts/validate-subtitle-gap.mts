import fs from "fs";
import path from "path";
import { generateAssContent } from "../src/pipeline/captionGenerator";
import { getSubtitlePreviewFrame } from "../../frontend/src/lib/animatedSubtitle";
import type { ClipTranscript } from "../../frontend/src/lib/api";

const transcript = JSON.parse(
  fs.readFileSync(
    path.join(
      "data",
      "v2820282061",
      "transcripts",
      "8cd9d51a-6357-43d3-8a57-10594334af7c.json"
    ),
    "utf-8"
  )
) as ClipTranscript;

const styles = [
  "one_at_a_time",
  "active_word",
  "block_highlight",
  "classic",
] as const;

console.log("=== Preview gap check (4.0–7.5s) ===");
for (const style of styles) {
  const gaps: number[] = [];
  for (let t = 4; t <= 7.5; t += 0.1) {
    const frame = getSubtitlePreviewFrame(transcript, t, {
      style,
      uppercase: false,
      highlightColor: "#FFD93D",
      fontSize: 72,
      positionPercent: 68,
      outlineWidth: 8,
      tailAfterSpeechSec: 0.3,
      clearGapThresholdSec: 0.8,
    });
    if (frame) gaps.push(t);
  }
  console.log(
    `${style}: visible at ${gaps.length ? gaps.map((x) => x.toFixed(1)).join(", ") : "NONE"}`
  );
}

function parseAssTime(s: string): number {
  const parts = s.trim().split(":");
  const h = +parts[0];
  const m = +parts[1];
  const [ss, cs = "0"] = parts[2].split(".");
  return h * 3600 + m * 60 + +ss + +cs / 100;
}

function eventsInGap(ass: string, gapStart: number, gapEnd: number): number {
  return ass
    .split("\n")
    .filter((l) => l.startsWith("Dialogue:"))
    .filter((l) => {
      const m = l.match(/Dialogue: \d+,([^,]+),([^,]+),/);
      if (!m) return false;
      const start = parseAssTime(m[1]);
      const end = parseAssTime(m[2]);
      return start < gapEnd && end > gapStart;
    }).length;
}

console.log("\n=== ASS events overlapping gap 4.62–7.5s ===");
for (const style of styles) {
  const ass = generateAssContent(
    { ...transcript, subtitle: { ...transcript.subtitle!, style } },
    0,
    20,
    1080,
    1920,
    undefined,
    {
      subtitleSettings: {
        ...transcript.subtitle!,
        style,
        tailAfterSpeechSec: 0.3,
        clearGapThresholdSec: 0.8,
      },
    }
  );
  const count = eventsInGap(ass, 4.62, 7.5);
  console.log(`${style}: ${count} events in gap (expect 0)`);
}
