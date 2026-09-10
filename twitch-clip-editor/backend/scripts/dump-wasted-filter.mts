import fs from "fs/promises";
import { initDb } from "../src/db/index.js";
import { getLayoutPreset } from "../src/pipeline/layoutPresets.js";
import { getQualityPreset } from "../src/services/qualityPresets.js";
import { getClipSegmentById } from "../src/services/clipSegmentsService.js";
import { loadEffectsForExport } from "../src/services/effectsLibraryService.js";
import {
  buildUnifiedCompositionGraph,
  resolveCompositionDimensions,
} from "../src/services/unifiedCompositionFilterGraph.js";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";

initDb();

const layout = getLayoutPreset("vertical-split-9x16")!;
const q = getQualityPreset("draft")!;
const dims = resolveCompositionDimensions(layout, q.resolutionScale);
const expanded = expandEmotionPreset({
  presetId: "wasted",
  effectStart: 1,
  effectEnd: 4,
  effectDuration: 3,
  clipDuration: 6,
  intensityPercent: 100,
});
const app = {
  presetId: "wasted",
  effectStart: 1,
  effectEnd: 4,
  effectDuration: 3,
  intensityPercent: 100,
  colorPreset: expanded.colorPreset,
  colorEffectStart: 1,
  colorEffectEnd: 4,
};
const s = getClipSegmentById("8751ebf7-4dc4-48a5-b6bd-ffc266f9898c");
const g = buildUnifiedCompositionGraph({
  sourcePath: "source.mp4",
  segments: [
    {
      vodStart: s.sourceStart,
      duration: s.sourceEnd - s.sourceStart,
      layout,
      outW: dims.outW,
      outH: dims.outH,
      zoomW: dims.zoomW,
      zoomH: dims.zoomH,
      resolutionScale: 1,
      speed: 1,
      presetApplications: [app] as never,
      effects: loadEffectsForExport(s.id),
    },
  ],
});
await fs.writeFile(
  "data/debug_wasted.txt",
  g.filterComplex.split(";").join(";\n")
);
console.log("parts", g.filterComplex.split(";").length);
