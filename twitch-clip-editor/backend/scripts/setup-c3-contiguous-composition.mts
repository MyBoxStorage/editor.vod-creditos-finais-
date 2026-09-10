/**
 * Create c3-contiguous-scene composition: 4 segments from same VOD scene (1150–1185)
 * with dead-time gaps, original bounds for join overlap material.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "../src/db/index.js";
import {
  createClipSegment,
  updateClipSegment,
} from "../src/services/clipSegmentsService.js";
import { createComposition } from "../src/services/compositionsService.js";
import { updateCompositionSubtitleSettings } from "../src/services/compositionsService.js";
import { transcribeClip } from "../src/services/clipTranscribeService.js";
import { trimPreview } from "../src/services/trimPreviewService.js";

initDb();

const VOD = "v2820282061";
const SCENE_ORIG_START = 1150;
const SCENE_ORIG_END = 1185;
const PRESET = "vertical-split-9x16";

/** 4 trechos de ~5s com descarte de tempo morto entre eles (mesma cena contígua no VOD). */
const SLICES = [
  { start: 1152.0, end: 1157.0, label: "fala bazuca" },
  { start: 1160.0, end: 1165.0, label: "sacanear/nerf" },
  { start: 1168.0, end: 1173.0, label: "pausa curta" },
  { start: 1176.0, end: 1181.0, label: "continuação cena" },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "validation_c3_contiguous");

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const segmentIds: string[] = [];
  for (const slice of SLICES) {
    const seg = createClipSegment({
      vodId: VOD,
      start: slice.start,
      end: slice.end,
    });
    updateClipSegment(seg.id, {
      originalSourceStart: SCENE_ORIG_START,
      originalSourceEnd: SCENE_ORIG_END,
    });
    await trimPreview(seg.id, slice.start, slice.end);
    console.log(`preview ${seg.id.slice(0, 8)} ${slice.label}`);
    segmentIds.push(seg.id);
  }

  console.log("transcribing…");
  for (const id of segmentIds) {
    await transcribeClip(id, { layoutPresetId: PRESET });
    console.log(`transcribed ${id.slice(0, 8)}`);
  }

  const comp = createComposition({
    vodId: VOD,
    name: "c3-contiguous-scene",
    clipSegmentIds: segmentIds,
  });

  updateCompositionSubtitleSettings(comp.id, {
    style: "one_at_a_time",
    highlightColor: "#FF6B6B",
    uppercase: false,
  });

  const meta = {
    compositionId: comp.id,
    name: "c3-contiguous-scene",
    vodId: VOD,
    segmentIds,
    slices: SLICES,
    sceneOriginal: [SCENE_ORIG_START, SCENE_ORIG_END],
    subtitleSettings: {
      style: "one_at_a_time",
      highlightColor: "#FF6B6B",
    },
  };
  await fs.writeFile(path.join(OUT, "composition.json"), JSON.stringify(meta, null, 2));
  console.log("Created composition", comp.id);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
