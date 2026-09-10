/**
 * Sprint 5 export validation — builds payloads from emotionPresets expansion.
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { expandEmotionPreset } from "../../frontend/src/lib/emotionPresets.ts";
import { exportCandidate } from "../src/services/candidateExportService.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATE_ID = "62920681-08e8-4591-90b9-5a80f55ebc5b";
const CLIP_DURATION = 18;
const OUT_DIR = path.join(__dirname, "..", "data", "validation_s5");

function appPayload(
  presetId: Parameters<typeof expandEmotionPreset>[0]["presetId"],
  effectStart: number
) {
  const dur =
    presetId === "wasted"
      ? 6
      : presetId === "emphasis"
        ? 0.4
        : presetId === "celebration"
          ? 0.9
          : 1;
  const effectEnd =
    presetId === "wasted"
      ? effectStart + Math.min(dur, CLIP_DURATION - effectStart)
      : effectStart + dur;
  const expanded = expandEmotionPreset({
    presetId,
    effectStart,
    effectEnd,
    effectDuration: presetId === "wasted" ? effectEnd - effectStart : undefined,
    clipDuration: CLIP_DURATION,
    intensityPercent: 100,
  });
  const row: Record<string, unknown> = {
    presetId,
    effectStart,
    effectEnd,
    intensityPercent: 100,
  };
  if (presetId === "wasted") row.effectDuration = effectEnd - effectStart;
  if (expanded.zoomKeyframes?.length) row.zoomKeyframes = expanded.zoomKeyframes;
  if (expanded.colorPreset && expanded.colorPreset !== "none") {
    row.colorPreset = expanded.colorPreset;
    row.colorEffectStart = effectStart;
    row.colorEffectEnd = effectEnd;
    if (presetId === "emphasis" || presetId === "surprise") row.colorFadeSeconds = 0;
  }
  if (expanded.speedRamp?.length) row.speedRamp = expanded.speedRamp;
  return { row, expanded };
}

function legacyFromExpanded(
  presetId: string,
  expanded: ReturnType<typeof expandEmotionPreset>,
  effectStart: number,
  effectEnd: number
) {
  if (presetId === "wasted") {
    return {
      wastedInsert: {
        insertAtTime: effectStart,
        effectDuration: effectEnd - effectStart,
        intensityPercent: 100,
      },
    };
  }
  const out: Record<string, unknown> = {};
  if (expanded.zoomKeyframes?.length) out.zoomKeyframes = expanded.zoomKeyframes;
  if (expanded.colorPreset && expanded.colorPreset !== "none") {
    out.colorPreset = expanded.colorPreset;
    out.colorIntensityPercent = 100;
    out.colorEffectStart = effectStart;
    out.colorEffectEnd = effectEnd;
    if (presetId === "emphasis" || presetId === "surprise") out.colorFadeSeconds = 0;
  }
  if (expanded.speedRamp?.length) out.speedRamp = expanded.speedRamp;
  return out;
}

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffprobe failed ${file}`));
      else resolve(parseFloat(out.trim()));
    });
  });
}

async function extractFrame(video: string, t: number, outPng: string) {
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-ss", String(t), "-i", video, "-frames:v", "1", outPng],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg frame @${t}`))
    );
  });
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const base = {
    useSubtitles: false,
    subtitleRange: null as null,
    quality: "draft" as const,
    speed: 1,
    preset: "vertical-split-9x16",
  };

  const emph = appPayload("emphasis", 3);
  const cel = appPayload("celebration", 12);

  console.log("=== 1a multi emphasis+celebration ===");
  const r1a = await exportCandidate(CANDIDATE_ID, {
    ...base,
    presetApplications: [emph.row, cel.row] as never,
  });
  const p1a = r1a.prontosPath;
  const d1a = await probeDuration(p1a);
  console.log(JSON.stringify({ path: p1a, duration: d1a, emph: emph.expanded.summary, cel: cel.expanded.summary }));

  const frames1a = [0, 2.5, 3.0, 3.2, 3.5, 11.5, 12.0, 12.5, 13.0, 17.5];
  for (const t of frames1a) {
    await extractFrame(p1a, t, path.join(OUT_DIR, `1a_${t.toFixed(1).replace(".", "_")}s.png`));
  }

  console.log("=== 1b multi emphasis+wasted ===");
  const wast = appPayload("wasted", 8);
  const r1b = await exportCandidate(CANDIDATE_ID, {
    ...base,
    presetApplications: [emph.row, wast.row] as never,
  });
  const p1b = r1b.prontosPath;
  const d1b = await probeDuration(p1b);
  console.log(JSON.stringify({ path: p1b, duration: d1b, wasted: wast.expanded.summary }));

  const frames1b = [2.5, 3.0, 3.3, 7.5, 8.0, 9.0, 10.0, 11.0, 14.0, 20.0, 23.0];
  for (const t of frames1b) {
    if (t <= d1b + 0.1)
      await extractFrame(p1b, t, path.join(OUT_DIR, `1b_${t.toFixed(1).replace(".", "_")}s.png`));
  }

  console.log("=== 1c legacy single emphasis ===");
  const leg = legacyFromExpanded("emphasis", emph.expanded, 3, 3.4);
  const r1cLeg = await exportCandidate(CANDIDATE_ID, { ...base, ...leg } as never);
  const p1cLeg = r1cLeg.prontosPath;

  console.log("=== 1c presetApplications[1] single emphasis ===");
  const r1cNew = await exportCandidate(CANDIDATE_ID, {
    ...base,
    presetApplications: [emph.row] as never,
  });
  const p1cNew = r1cNew.prontosPath;

  const dLeg = await probeDuration(p1cLeg);
  const dNew = await probeDuration(p1cNew);
  const sLeg = (await fs.stat(p1cLeg)).size;
  const sNew = (await fs.stat(p1cNew)).size;

  for (const t of [2.5, 3.0, 3.2, 3.5]) {
    await extractFrame(p1cLeg, t, path.join(OUT_DIR, `1c_leg_${t.toFixed(1).replace(".", "_")}s.png`));
    await extractFrame(p1cNew, t, path.join(OUT_DIR, `1c_new_${t.toFixed(1).replace(".", "_")}s.png`));
  }

  console.log(
    JSON.stringify({
      legacy: { path: p1cLeg, duration: dLeg, size: sLeg },
      singleArray: { path: p1cNew, duration: dNew, size: sNew },
      sameSize: sLeg === sNew,
      sameDuration: Math.abs(dLeg - dNew) < 0.05,
    })
  );

  await fs.writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ p1a, d1a, p1b, d1b, p1cLeg, p1cNew, dLeg, dNew, sLeg, sNew }, null, 2)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
