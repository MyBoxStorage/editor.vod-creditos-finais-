import { initDb } from "../src/db/index.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportUnifiedComposition } from "../src/services/unifiedCompositionExportService.js";

initDb();

const expanded = expandEmotionPreset({
  presetId: "wasted",
  effectStart: 1,
  effectEnd: 4,
  effectDuration: 3,
  clipDuration: 6,
  intensityPercent: 100,
});

const appW = {
  presetId: "wasted",
  effectStart: 1,
  effectEnd: 4,
  effectDuration: 3,
  intensityPercent: 100,
  colorPreset: expanded.colorPreset,
  colorEffectStart: 1,
  colorEffectEnd: 4,
};

try {
  const r = await exportUnifiedComposition({
    vodId: "v2820282061",
    quality: "draft",
    preset: "vertical-split-9x16",
    segments: [
      {
        clipSegmentId: "8751ebf7-4dc4-48a5-b6bd-ffc266f9898c",
        presetApplications: [appW] as never,
      },
    ],
    outputName: "wasted_single_test.mp4",
  });
  console.log("OK", r);
} catch (e) {
  console.error("FAIL", e);
  process.exit(1);
}
