import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { getLayoutPreset } from "../src/pipeline/layoutPresets.js";
import { getQualityPreset } from "../src/services/qualityPresets.js";
import {
  buildUnifiedCompositionGraph,
  resolveCompositionDimensions,
} from "../src/services/unifiedCompositionFilterGraph.js";
import { loadEffectsForExport } from "../src/services/effectsLibraryService.js";
import path from "path";
import fs from "fs/promises";
import { getDataDir } from "../src/services/vodIngest.js";
import { parseCompositionJoinSettings } from "../src/services/compositionJoinSettings.js";
import { parseCompositionColorSettings } from "../src/services/compositionColorSettings.js";

initDb();
const comp = getCompositionWithSegments("ca94471d-ab2e-444e-96ff-1bd2ed1837bf");
const vodId = comp.vodId!;
const layout = getLayoutPreset("vertical-split-9x16")!;
const quality = getQualityPreset("hd")!;
const dims = resolveCompositionDimensions(layout, quality.resolutionScale);
const sourcePath = path.join(getDataDir(), vodId, "source.mp4");
const segments = comp.segments
  .sort((a, b) => a.orderIndex - b.orderIndex)
  .map((s) => {
    const cs = s.clipSegment;
    const dur = cs.sourceEnd - cs.sourceStart;
    return {
      vodStart: cs.sourceStart,
      duration: dur,
      sourceBounds: {
        vodStart: cs.sourceStart,
        vodEnd: cs.sourceEnd,
        materialStart: cs.originalSourceStart ?? cs.sourceStart,
        materialEnd: cs.originalSourceEnd ?? cs.sourceEnd,
      },
      layout,
      outW: dims.outW,
      outH: dims.outH,
      zoomW: dims.zoomW,
      zoomH: dims.zoomH,
      resolutionScale: quality.resolutionScale,
      speed: 1,
      presetApplications: cs.presetApplicationsJson as never,
      effects: loadEffectsForExport(cs.id),
    };
  });
const g = buildUnifiedCompositionGraph({
  sourcePath,
  segments,
  joinSettings: parseCompositionJoinSettings(null),
  colorSettings: parseCompositionColorSettings(null),
  subtitlesFilter: null,
});
const parts = g.filterComplex.split(";");
const bad = parts
  .map((p, i) => ({ i, p }))
  .filter(
    ({ p }) =>
      !p.trim() ||
      p.includes(";;") ||
      /[^[]\[\][^]]/.test(p) ||
      p.match(/\][ ]*\[/)?.[0] === "]["
  );
await fs.writeFile(
  "scripts/_debug-filter.txt",
  g.filterComplex.replace(/;/g, ";\n")
);
console.log(
  "durations",
  segments.map((s) => s.duration),
  "total",
  segments.reduce((a, s) => a + s.duration, 0)
);
console.log("parts", parts.length, "bad", bad.length);
for (const b of bad.slice(0, 10)) console.log("BAD", b.i, b.p);
