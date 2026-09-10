import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";
import {
  burnCaptions,
  concatClips,
  renderClip,
} from "../pipeline/clipRenderer";
import { writeClipCaptions } from "../pipeline/captionGenerator";
import { publishToProntos } from "./prontosPublisher";

export type ExportProgress =
  | "queued"
  | "cutting"
  | "generating_captions"
  | "burning_captions"
  | "concatenating"
  | "done"
  | "error";

export type ExportResult = {
  vodId: string;
  clipId: string;
  finalPath: string;
  finalUrlPath: string;
  version: number;
  elapsedMs: number;
  prontosPath?: string;
  prontosFileName?: string;
  runId?: string;
  hasHook?: boolean;
};

async function nextFinalPath(clipDir: string): Promise<{
  finalPath: string;
  version: number;
  fileName: string;
}> {
  const entries = await fs.readdir(clipDir).catch(() => [] as string[]);
  const versions = entries
    .map((name) => {
      if (name === "final.mp4") return 1;
      const m = name.match(/^final_v(\d+)\.mp4$/i);
      return m ? Number(m[1]) : null;
    })
    .filter((n): n is number => n != null);

  const next = versions.length === 0 ? 1 : Math.max(...versions) + 1;
  const fileName = next === 1 ? "final.mp4" : `final_v${next}.mp4`;
  return {
    finalPath: path.join(clipDir, fileName),
    version: next,
    fileName,
  };
}

async function assertAssUsable(assPath: string): Promise<void> {
  let assStat;
  try {
    assStat = await fs.stat(assPath);
  } catch {
    throw new Error(
      `Export aborted: captions.ass was not created at ${assPath}`
    );
  }
  if (!(assStat.size > 0)) {
    throw new Error(`Export aborted: captions.ass is empty at ${assPath}`);
  }
  const assText = await fs.readFile(assPath, "utf-8");
  if (!/^Style:/m.test(assText)) {
    throw new Error(
      `Export aborted: captions.ass is missing Style header at ${assPath}`
    );
  }
  if (!/^Dialogue:/m.test(assText)) {
    console.warn(
      `[export] captions.ass has no Dialogue lines at ${assPath} (sem palavras na transcrição deste intervalo) — queimando ASS vazio`
    );
  }
}

async function assertNonEmptyMp4(filePath: string, label: string): Promise<void> {
  try {
    const st = await fs.stat(filePath);
    if (!(st.size > 0)) {
      throw new Error(`Export aborted: ${label} is empty at ${filePath}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Export aborted")) {
      throw err;
    }
    throw new Error(`Export aborted: ${label} missing at ${filePath}`);
  }
}

/**
 * Render + caption-burn one interval into outputPath (same layout as main clip).
 */
async function renderBurnedSegment(options: {
  vodId: string;
  clipId: string;
  start: number;
  end: number;
  layoutPresetId: string;
  transcriptPath: string;
  rawFileName: string;
  assFileName: string;
  burnedFileName: string;
  writeClipJson?: boolean;
}): Promise<string> {
  const clipDir = path.join(getDataDir(), options.vodId, "clips", options.clipId);
  const rendered = await renderClip({
    vodId: options.vodId,
    clipId: options.clipId,
    start: options.start,
    end: options.end,
    layoutPresetId: options.layoutPresetId,
    rawFileName: options.rawFileName,
    writeClipJson: options.writeClipJson,
  });
  const assPath = path.join(clipDir, options.assFileName);
  await writeClipCaptions({
    transcriptPath: options.transcriptPath,
    clipStart: options.start,
    clipEnd: options.end,
    layoutPresetId: options.layoutPresetId,
    outputAssPath: assPath,
  });
  await assertAssUsable(assPath);
  const burnedPath = path.join(clipDir, options.burnedFileName);
  await burnCaptions(rendered.rawPath, assPath, burnedPath);
  await assertNonEmptyMp4(burnedPath, options.burnedFileName);
  return burnedPath;
}

export async function exportClip(
  vodId: string,
  clipId: string,
  options: {
    start: number;
    end: number;
    layoutPresetId: string;
    hookStart?: number;
    hookEnd?: number;
    onProgress?: (step: ExportProgress) => void;
  }
): Promise<ExportResult> {
  const t0 = Date.now();
  const report = (step: ExportProgress) => options.onProgress?.(step);

  const vodDir = path.join(getDataDir(), vodId);
  const clipDir = path.join(vodDir, "clips", clipId);
  const transcriptPath = path.join(vodDir, "transcript.json");

  const hasHook =
    typeof options.hookStart === "number" &&
    typeof options.hookEnd === "number" &&
    options.hookEnd > options.hookStart;

  if (
    (typeof options.hookStart === "number") !==
      (typeof options.hookEnd === "number") ||
    (typeof options.hookStart === "number" &&
      typeof options.hookEnd === "number" &&
      !(options.hookEnd > options.hookStart))
  ) {
    throw new Error(
      "Invalid hook range: provide both hookStart and hookEnd with hookEnd > hookStart"
    );
  }

  report("cutting");
  const rendered = await renderClip({
    vodId,
    clipId,
    start: options.start,
    end: options.end,
    layoutPresetId: options.layoutPresetId,
  });

  report("generating_captions");
  const assPath = path.join(clipDir, "captions.ass");
  await writeClipCaptions({
    transcriptPath,
    clipStart: options.start,
    clipEnd: options.end,
    layoutPresetId: options.layoutPresetId,
    outputAssPath: assPath,
  });

  report("burning_captions");
  await assertAssUsable(assPath);

  const { finalPath, version, fileName } = await nextFinalPath(clipDir);

  let publishSource = finalPath;

  if (hasHook) {
    const bodyPath = path.join(clipDir, "body_burned.mp4");
    await burnCaptions(rendered.rawPath, assPath, bodyPath);
    await assertNonEmptyMp4(bodyPath, "body_burned.mp4");

    report("cutting");
    const hookBurned = await renderBurnedSegment({
      vodId,
      clipId,
      start: options.hookStart!,
      end: options.hookEnd!,
      layoutPresetId: options.layoutPresetId,
      transcriptPath,
      rawFileName: "hook_raw.mp4",
      assFileName: "hook_captions.ass",
      burnedFileName: "hook_burned.mp4",
      writeClipJson: false,
    });

    report("concatenating");
    await concatClips(hookBurned, bodyPath, finalPath);
    await assertNonEmptyMp4(finalPath, "final (with hook)");
    publishSource = finalPath;
  } else {
    await burnCaptions(rendered.rawPath, assPath, finalPath);
    await assertNonEmptyMp4(finalPath, "final.mp4");
  }

  const published = await publishToProntos({
    vodId,
    start: options.start,
    end: options.end,
    sourceFinalPath: publishSource,
    hasHook,
  });

  report("done");
  return {
    vodId,
    clipId,
    finalPath,
    finalUrlPath: `/media/${vodId}/clips/${clipId}/${fileName}`,
    version,
    elapsedMs: Date.now() - t0,
    prontosPath: published.prontosPath,
    prontosFileName: published.fileName,
    runId: published.runId,
    hasHook,
  };
}
