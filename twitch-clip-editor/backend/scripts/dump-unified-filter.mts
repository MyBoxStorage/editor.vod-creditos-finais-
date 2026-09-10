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

function app(
  presetId: Parameters<typeof expandEmotionPreset>[0]["presetId"],
  effectStart: number,
  clipDuration: number
) {
  const dur = presetId === "wasted" ? 3 : presetId === "emphasis" ? 0.4 : 0.9;
  const effectEnd = effectStart + dur;
  const expanded = expandEmotionPreset({
    presetId,
    effectStart,
    effectEnd,
    effectDuration: presetId === "wasted" ? dur : undefined,
    clipDuration,
    intensityPercent: 100,
  });
  const row: Record<string, unknown> = {
    presetId,
    effectStart,
    effectEnd,
    intensityPercent: 100,
  };
  if (presetId === "wasted") row.effectDuration = dur;
  if (expanded.zoomKeyframes?.length) row.zoomKeyframes = expanded.zoomKeyframes;
  if (expanded.colorPreset && expanded.colorPreset !== "none") {
    row.colorPreset = expanded.colorPreset;
    row.colorEffectStart = effectStart;
    row.colorEffectEnd = effectEnd;
  }
  if (expanded.speedRamp?.length) row.speedRamp = expanded.speedRamp;
  return row;
}

const layout = getLayoutPreset("vertical-split-9x16")!;
const q = getQualityPreset("max")!;
const dims = resolveCompositionDimensions(layout, q.resolutionScale);
const ids = [
  "5a38accd-25ca-44bc-b0eb-1cd61dfe36a8",
  "4cb0313f-c5a8-4bbd-bb89-fecfad6c687f",
  "8751ebf7-4dc4-48a5-b6bd-ffc266f9898c",
];
const apps = [
  app("emphasis", 0.5, 2),
  app("celebration", 1, 5),
  app("wasted", 1, 6),
];

const segs = ids.map((id, i) => {
  const s = getClipSegmentById(id);
  return {
    vodStart: s.sourceStart,
    duration: s.sourceEnd - s.sourceStart,
    layout,
    outW: dims.outW,
    outH: dims.outH,
    zoomW: dims.zoomW,
    zoomH: dims.zoomH,
    resolutionScale: q.resolutionScale,
    speed: 1,
    presetApplications: [apps[i]] as never,
    effects: loadEffectsForExport(id),
  };
});

const g = buildUnifiedCompositionGraph({
  sourcePath: "source.mp4",
  segments: segs,
});
await fs.writeFile("data/debug_filter.txt", g.filterComplex);
console.log("written", g.filterComplex.length);
