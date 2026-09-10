import { initDb } from "../src/db/index.js";
import { listEffectLibraryItems } from "../src/services/effectsLibraryService.js";

initDb();
const t0 = performance.now();
const items = listEffectLibraryItems({ includeArchived: true });
const dbMs = performance.now() - t0;
const json = JSON.stringify({ items });
console.log("count", items.length);
console.log("db+map ms", Math.round(dbMs));
console.log("payload bytes", json.length);
console.log("bytes per item", Math.round(json.length / Math.max(1, items.length)));
const sample = items[0];
if (sample) {
  for (const k of Object.keys(sample) as (keyof typeof sample)[]) {
    const total = items.reduce(
      (s, i) => s + JSON.stringify(i[k] ?? null).length,
      0
    );
    console.log(String(k).padEnd(22), total);
  }
}
