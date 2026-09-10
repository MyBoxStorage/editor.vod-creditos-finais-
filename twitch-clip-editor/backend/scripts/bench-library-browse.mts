/**
 * Benchmark library list: full vs paginated browse.
 */
import { initDb } from "../src/db/index.js";
import {
  browseEffectLibraryCards,
  listEffectLibraryItems,
} from "../src/services/effectsLibraryService.js";

initDb();

function size(label: string, obj: unknown) {
  const json = JSON.stringify(obj);
  console.log(`${label}: ${json.length} bytes`);
}

const all = listEffectLibraryItems({ includeArchived: true });
console.log("items:", all.length);
size("OLD full payload", { items: all });

const t0 = performance.now();
browseEffectLibraryCards({ limit: 48, sort: "mostUsed" });
console.log("SQL browse page1 ms:", Math.round(performance.now() - t0));

const page1 = browseEffectLibraryCards({ limit: 48, sort: "mostUsed" });
size("NEW page1 payload", page1);
console.log("page1 items:", page1.items.length, "total:", page1.total);

const base = process.env.API_BASE ?? "http://localhost:3001";

async function httpBench(label: string, path: string) {
  const t = performance.now();
  const res = await fetch(`${base}${path}`);
  const body = await res.text();
  console.log(
    `${label}: ${Math.round(performance.now() - t)}ms, ${body.length} bytes`
  );
}

await httpBench("HTTP OLD", "/effects-library?includeArchived=true");
await httpBench("HTTP NEW browse", "/effects-library/browse?limit=48&sort=mostUsed");
await httpBench("HTTP NEW sections", "/effects-library/sections");
