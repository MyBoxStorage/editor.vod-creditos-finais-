import { spawn } from "child_process";
import { performance } from "perf_hooks";
import { findClipEditableById } from "../src/services/clipEditable.ts";
import { trimPreview } from "../src/services/trimPreviewService.ts";
import { exportCandidate } from "../src/services/candidateExportService.ts";

const CID = "62920681-08e8-4591-90b9-5a80f55ebc5b";
const FRAME_AT_30FPS = 1 / 30;

function probe(p: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        p,
      ],
      { windowsHide: true, shell: process.platform === "win32" }
    );
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve(parseFloat(out.trim())) : reject(new Error("ffprobe"))
    );
  });
}

function withinFrameTolerance(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= FRAME_AT_30FPS + 0.001;
}

async function testTrim(label: string, start: number, end: number) {
  const requested = end - start;
  const t0 = performance.now();
  const tr = await trimPreview(CID, start, end);
  const trimMs = performance.now() - t0;
  const prevDur = await probe(tr.previewPath);
  const ex = await exportCandidate(CID, {
    useSubtitles: false,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
  });
  const outDur = await probe(ex.prontosPath);
  console.log(
    JSON.stringify({
      label,
      requested,
      marked: tr.candidate.end - tr.candidate.start,
      previewDur: Number(prevDur.toFixed(4)),
      exportDur: Number(outDur.toFixed(4)),
      deltaPreview: Number((prevDur - requested).toFixed(4)),
      deltaExport: Number((outDur - requested).toFixed(4)),
      previewOk: withinFrameTolerance(prevDur, requested),
      exportOk: withinFrameTolerance(outDur, requested),
      trimMs: Math.round(trimMs),
      usedCopy: tr.usedCopy,
    })
  );
}

async function main() {
  const c0 = await findClipEditableById(CID);
  console.log(
    JSON.stringify({
      phase: "setup",
      start: c0.start,
      end: c0.end,
      marked: c0.end - c0.start,
    })
  );

  await testTrim("trim_18s", 1152, 1170);
  await testTrim("trim_10s", 1155, 1165);
  await testTrim("trim_5s", 1157.5, 1162.5);

  await trimPreview(CID, 1152, 1170);
  console.log(JSON.stringify({ phase: "restored" }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
