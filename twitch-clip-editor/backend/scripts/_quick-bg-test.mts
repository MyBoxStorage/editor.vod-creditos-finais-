import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { createEffectLibraryItem, applyEffectToClip } from "../src/services/effectsLibraryService.js";
import { exportCandidate } from "../src/services/candidateExportService.js";
import fs from "fs/promises";
import path from "path";

initDb();
const meta = JSON.parse(await fs.readFile("data/validation_c3_contiguous/composition.json", "utf8"));
const comp = getCompositionWithSegments(meta.compositionId);
const candidateId = comp.segments[0].clipSegment.id;
console.log("candidate", candidateId);

const dest = "data/validation_bg_removal/lettering-screen.mp4";
await fs.copyFile("data/validation_bg_removal/lettering-3s.mp4", dest);
const item = await createEffectLibraryItem({
  type: "video",
  name: "Lettering screen quick",
  tempFilePath: path.resolve(dest),
  originalFileName: "lettering-screen.mp4",
  backgroundRemovalMode: "screen",
  chromaKeyColor: "#000000",
  skipPreviews: true,
});
console.log("item", item.id);

await applyEffectToClip(candidateId, {
  effectLibraryItemId: item.id,
  sourceTrimStart: 0,
  sourceTrimEnd: 3,
  clipTimestamp: 0,
  positionWidth: 100,
  positionHeight: 100,
});

try {
  const r = await exportCandidate(candidateId, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
  });
  console.log("export ok", r);
} catch (e) {
  console.error("export fail", e);
}
