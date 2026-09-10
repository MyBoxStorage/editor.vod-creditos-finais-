import { spawn } from "child_process";
import path from "path";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportCandidate } from "../src/services/candidateExportService.ts";

const CID = "62920681-08e8-4591-90b9-5a80f55ebc5b";
const base = {
  useSubtitles: false,
  subtitleRange: null,
  quality: "draft" as const,
  speed: 1,
  preset: "vertical-split-9x16",
};

function legacy(presetId: "emphasis" | "celebration", start: number) {
  const dur = presetId === "emphasis" ? 0.4 : 0.9;
  const end = start + dur;
  const ex = expandEmotionPreset({
    presetId,
    effectStart: start,
    effectEnd: end,
    clipDuration: 20,
    intensityPercent: 100,
  });
  const o: Record<string, unknown> = {};
  if (ex.zoomKeyframes) o.zoomKeyframes = ex.zoomKeyframes;
  if (ex.colorPreset && ex.colorPreset !== "none") {
    o.colorPreset = ex.colorPreset;
    o.colorIntensityPercent = 100;
    o.colorEffectStart = start;
    o.colorEffectEnd = end;
    if (presetId === "emphasis") o.colorFadeSeconds = 0;
  }
  return o;
}

async function frame(video: string, t: number, out: string) {
  await new Promise<void>((res, rej) => {
    spawn(
      "ffmpeg",
      ["-y", "-ss", String(t), "-i", video, "-frames:v", "1", out],
      { shell: true, windowsHide: true }
    ).on("close", (c) => (c === 0 ? res() : rej(new Error("ff"))));
  });
}

const outDir = path.join(process.cwd(), "data", "validation_s5");
const cel = await exportCandidate(CID, {
  ...base,
  ...legacy("celebration", 12),
});
console.log("celebration only", cel.prontosPath);
await frame(cel.prontosPath, 12.2, path.join(outDir, "solo_cel_12_2.png"));
await frame(cel.prontosPath, 11.8, path.join(outDir, "solo_cel_11_8.png"));
