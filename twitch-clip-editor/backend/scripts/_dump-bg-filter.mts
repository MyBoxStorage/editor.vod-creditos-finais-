import { initDb } from "../src/db/index.js";
import { listEffectsForClip } from "../src/services/effectsLibraryService.js";
import { buildVideoOverlayFilters } from "../src/services/effectsExportFilters.js";

initDb();
const cid = "1398beb0-2904-4a85-90b0-48353924662a";
const effects = await listEffectsForClip(cid);
console.log("instances", effects.length);
// Need loaded effects with paths - simplified: just print filter with mock
import { loadEffectsForExport } from "../src/services/effectsLibraryService.js";
const loaded = await loadEffectsForExport(cid);
console.log(
  buildVideoOverlayFilters(loaded, loaded.map((_, i) => i + 1), 540, 960, "vcore", "vovl", "", 5)
);
