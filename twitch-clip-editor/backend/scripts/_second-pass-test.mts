import fs from "fs";
import path from "path";
import { initDb } from "../src/db/index.js";
import { loadEffectsForExport } from "../src/services/effectsLibraryService.js";
import { applyLibraryEffectsOntoFile } from "../src/services/candidateExportService.js";

initDb();

const candidateId = "3c8e4c22-5448-4011-b9d3-04bed71c6fcf";
const inputPath =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/data/v2820282061/prontos/run_2026-07-22_15h03_semantic/3c8e4c22-5448-4011-b9d3-04bed71c6fcf_final.mp4";
const outPath =
  "C:/Users/pc/Desktop/Projetos/CLIP.VOD/twitch-clip-editor/backend/scripts/_second-pass-test.mp4";

const effects = loadEffectsForExport(candidateId);
console.log("effects", effects.length);

await applyLibraryEffectsOntoFile({
  inputPath,
  outputPath: outPath,
  effects,
  frameW: 1080,
  frameH: 1920,
  crf: 23,
  x264Preset: "veryfast",
  audioBitrate: "128k",
});

console.log("done", fs.existsSync(outPath));
