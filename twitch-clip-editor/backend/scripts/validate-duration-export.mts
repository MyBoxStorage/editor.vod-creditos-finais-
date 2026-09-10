import { spawn } from "child_process";
import { exportCandidate } from "../src/services/candidateExportService.ts";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";

const CID = "62920681-08e8-4591-90b9-5a80f55ebc5b";
const CLIP = 18;

function probe(p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        p,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
    );
  });
}

const expanded = expandEmotionPreset({
  presetId: "emphasis",
  effectStart: 9,
  effectEnd: 9.4,
  clipDuration: CLIP,
  intensityPercent: 100,
});

const result = await exportCandidate(CID, {
  useSubtitles: false,
  subtitleRange: null,
  quality: "draft",
  speed: 1,
  preset: "vertical-split-9x16",
  zoomKeyframes: expanded.zoomKeyframes,
  colorPreset: expanded.colorPreset,
  colorIntensityPercent: 100,
  colorEffectStart: expanded.effectStart,
  colorEffectEnd: expanded.effectEnd,
});

const dur = await probe(result.prontosPath);
console.log(
  JSON.stringify({
    exportDur: Number(dur.toFixed(4)),
    expected: CLIP,
    ok: Math.abs(dur - CLIP) <= 1 / 30 + 0.01,
    effectStart: expanded.effectStart,
    path: result.prontosRelativePath,
  })
);
