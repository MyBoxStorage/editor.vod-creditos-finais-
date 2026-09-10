import path from "path";
import { initDb } from "../src/db/index.js";
import {
  getLibraryDir,
  listEffectsForClip,
} from "../src/services/effectsLibraryService.js";
import {
  appendEffectInputs,
  buildVideoOverlayFilters,
  hasVideoEffects,
} from "../src/services/effectsExportFilters.js";

initDb();
const effects = await listEffectsForClip(
  "3c8e4c22-5448-4011-b9d3-04bed71c6fcf"
);
const loaded = effects.map((e) => ({
  instance: e,
  libraryItem: e.libraryItem!,
  absoluteFilePath: path.join(
    getLibraryDir(),
    e.libraryItem!.filePath.replace(/^_library\//, "")
  ),
}));
console.log("hasVideo", hasVideoEffects(loaded));
console.log("path", loaded[0]?.absoluteFilePath);
const args: string[] = [];
const idx = appendEffectInputs(args, loaded);
console.log("inputArgs", args.join(" "));
console.log("filter", buildVideoOverlayFilters(loaded, idx, 1080, 1920, "vscaled", "vfinal"));
