import { initDb } from "../src/db/index.js";
import { getCompositionWithSegments } from "../src/services/compositionsService.js";
import { createEffectLibraryItem, applyEffectToClip, listEffectsForClip, removeEffectFromClip } from "../src/services/effectsLibraryService.js";
import { exportCandidate } from "../src/services/candidateExportService.js";
import fs from "fs/promises";
import path from "path";

initDb();
const meta = JSON.parse(await fs.readFile("data/validation_c3_contiguous/composition.json", "utf8"));
const candidateId = getCompositionWithSegments(meta.compositionId).segments[0].clipSegment.id;

for (const e of await listEffectsForClip(candidateId)) {
  await removeEffectFromClip(candidateId, e.id);
}

for (const mode of ["chroma", "solid", "luminance"] as const) {
  const dest = path.resolve(`data/validation_bg_removal/t-${mode}.mp4`);
  await fs.copyFile("data/validation_bg_removal/lettering-3s.mp4", dest);
  const item = await createEffectLibraryItem({
    type: "video",
    name: `T ${mode}`,
    tempFilePath: dest,
    originalFileName: `${mode}.mp4`,
    backgroundRemovalMode: mode,
    chromaKeyColor: "#000000",
    chromaKeySimilarity: 0.15,
    chromaKeyBlend: 0.08,
    skipPreviews: true,
  });
  for (const e of await listEffectsForClip(candidateId)) await removeEffectFromClip(candidateId, e.id);
  await applyEffectToClip(candidateId, { effectLibraryItemId: item.id, sourceTrimStart: 0, sourceTrimEnd: 3, clipTimestamp: 0, positionWidth: 90, positionHeight: 25 });
  try {
    const r = await exportCandidate(candidateId, { useSubtitles: false, subtitleRange: null, quality: "draft", speed: 1, preset: "vertical-split-9x16" });
    console.log(mode, "OK", r.prontosPath);
  } catch (err) {
    console.error(mode, "FAIL", err);
  }
}
