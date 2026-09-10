import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { exportCandidate } from "../src/services/candidateExportService.ts";
import { saveClipTranscript } from "../src/services/clipTranscribeService.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID = "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6";
const VOD = path.join(__dirname, "..", "data", "v2820282061");
const TRANSCRIPT = path.join(VOD, "transcripts", `${ID}.json`);

async function setStyle(style: "classic" | "active_word" | "one_at_a_time") {
  const raw = await fs.readFile(TRANSCRIPT, "utf-8");
  const t = JSON.parse(raw);
  t.subtitle = {
    style,
    uppercase: false,
    highlightColor: "#FFD93D",
    fontSize: 72,
    positionPercent: 68,
    outlineWidth: 8,
  };
  await fs.writeFile(TRANSCRIPT, JSON.stringify(t, null, 2));
}

async function runExport(label: string) {
  const t0 = Date.now();
  const r = await exportCandidate(ID, {
    useSubtitles: true,
    subtitleRange: null,
    quality: "hd",
    speed: 1,
    preset: "vertical-split-9x16",
  });
  const ms = Date.now() - t0;
  const dest = path.join(
    __dirname,
    "..",
    "data",
    "_val_frames",
    `${label}_hd.mp4`
  );
  await fs.copyFile(r.prontosPath, dest);
  console.log(JSON.stringify({ label, ms, path: dest }));
  return { ms, path: dest };
}

async function main() {
  await setStyle("classic");
  const classic = await runExport("classic");

  await setStyle("active_word");
  const active = await runExport("active_word");

  await setStyle("one_at_a_time");
  const one = await runExport("one_at_a_time");

  console.log(
    JSON.stringify(
      {
        classicMs: classic.ms,
        activeWordMs: active.ms,
        oneAtATimeMs: one.ms,
        animationOverheadMs: active.ms - classic.ms,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
