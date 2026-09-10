import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import {
  sourceMaterialMargins,
  resolveJoinSettings,
  parseCompositionJoinSettings,
} from "../src/services/compositionJoinSettings.js";

initDb();
const comp = getCompositionWithSegments("ca94471d-ab2e-444e-96ff-1bd2ed1837bf");
const segs = comp.segments.sort((a, b) => a.orderIndex - b.orderIndex);
const bounds = segs.map((s) => {
  const cs = s.clipSegment;
  return {
    vodStart: cs.sourceStart,
    vodEnd: cs.sourceEnd,
    materialStart: cs.originalSourceStart ?? cs.sourceStart,
    materialEnd: cs.originalSourceEnd ?? cs.sourceEnd,
    dur: cs.sourceEnd - cs.sourceStart,
  };
});
const durs = bounds.map((b) => b.dur);
const joins = resolveJoinSettings(parseCompositionJoinSettings(null), bounds, durs);
for (let i = 0; i < bounds.length; i++) {
  const m = sourceMaterialMargins(bounds[i], 999999);
  console.log(`seg${i + 1}`, bounds[i].vodStart.toFixed(1), bounds[i].vodEnd.toFixed(1), "margin before/after", m.before, m.after);
}
console.log("joins", JSON.stringify(joins, null, 2));
