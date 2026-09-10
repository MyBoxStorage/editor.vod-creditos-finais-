/**
 * Seed 200+ test library items using ffmpeg-generated tiny media files.
 * Usage: npx tsx scripts/seed-library-test-items.mts [--count=220]
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { initDb } from "../src/db/index.js";
import {
  bulkCreateEffectLibraryItems,
  getLibraryDir,
  listEffectLibraryItems,
} from "../src/services/effectsLibraryService.js";
import { SENSATION_TAGS } from "../src/lib/sensationTags.js";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

async function makeTone(
  outPath: string,
  seconds: number,
  freq: number
): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:duration=${seconds}`,
    "-c:a",
    "libmp3lame",
    outPath,
  ]);
}

async function makeColorVideo(outPath: string, seconds: number): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x4488ff:s=320x180:d=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

async function main() {
  const countArg = process.argv.find((a) => a.startsWith("--count="));
  const count = countArg ? Number(countArg.split("=")[1]) : 220;

  initDb();
  const existing = listEffectLibraryItems({ includeArchived: true }).length;
  console.log(`Existing items: ${existing}`);

  const tmpDir = path.join(getLibraryDir(), "_seed_tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const toCreate: Parameters<typeof bulkCreateEffectLibraryItems>[0] = [];
  const types = ["video", "music", "sfx"] as const;

  for (let i = 0; i < count; i += 1) {
    const type = types[i % 3];
    const sensation = SENSATION_TAGS[i % SENSATION_TAGS.length];
    const name = `teste ${type} ${i + 1} ${sensation}`;
    const fileName =
      type === "video" ? `seed_${i}.mp4` : `seed_${i}.mp3`;
    const abs = path.join(tmpDir, fileName);

    if (type === "video") {
      await makeColorVideo(abs, 1.5);
    } else {
      await makeTone(abs, 1.2, 220 + (i % 500));
    }

    toCreate.push({
      type,
      name,
      sensationTags: [sensation],
      tags: [`seed`, `batch-${Math.floor(i / 20)}`],
      tempFilePath: abs,
      originalFileName: fileName,
      skipPreviews: true,
    });
  }

  console.log(`Creating ${toCreate.length} items…`);
  const start = Date.now();
  const created = await bulkCreateEffectLibraryItems(toCreate);
  console.log(`Created ${created.length} in ${Date.now() - start} ms`);
  console.log(
    `Total now: ${listEffectLibraryItems({ includeArchived: true }).length}`
  );

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
