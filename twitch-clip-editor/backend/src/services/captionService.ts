import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import { writeClipCaptions } from "../pipeline/captionGenerator";
import { burnCaptions } from "../pipeline/clipRenderer";

export async function generateAndBurnCaptions(
  vodId: string,
  clipId: string
): Promise<{
  vodId: string;
  clipId: string;
  assPath: string;
  finalPath: string;
}> {
  const vodDir = path.join(getDataDir(), vodId);
  const clipDir = path.join(vodDir, "clips", clipId);
  const clipMetaPath = path.join(clipDir, "clip.json");
  const rawPath = path.join(clipDir, "raw.mp4");
  const assPath = path.join(clipDir, "captions.ass");
  const finalPath = path.join(clipDir, "final.mp4");
  const transcriptPath = path.join(vodDir, "transcript.json");

  const clipMetaRaw = await fs.readFile(clipMetaPath, "utf-8");
  const clipMeta = JSON.parse(clipMetaRaw) as {
    start: number;
    end: number;
    layoutPresetId: string;
  };

  try {
    await fs.access(rawPath);
  } catch {
    throw new Error(`raw.mp4 not found for clipId=${clipId}`);
  }

  try {
    await fs.access(transcriptPath);
  } catch {
    throw new Error(`transcript.json not found for vodId=${vodId}`);
  }

  await writeClipCaptions({
    transcriptPath,
    clipStart: clipMeta.start,
    clipEnd: clipMeta.end,
    layoutPresetId: clipMeta.layoutPresetId,
    outputAssPath: assPath,
  });

  await burnCaptions(rawPath, assPath, finalPath);

  return { vodId, clipId, assPath, finalPath };
}
