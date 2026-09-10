import fs from "fs";
import { initDb } from "../src/db/index.js";
import { previewRenderWindow } from "../src/services/previewRenderService.js";

initDb();

const candidateId = "3c8e4c22-5448-4011-b9d3-04bed71c6fcf";
const result = await previewRenderWindow(candidateId, {
  windowStart: 2.5,
  windowEnd: 5.5,
  useSubtitles: false,
  subtitleRange: null,
  quality: "hd",
  speed: 1,
  preset: "vertical-split-9x16",
});

console.log(JSON.stringify(result, null, 2));
