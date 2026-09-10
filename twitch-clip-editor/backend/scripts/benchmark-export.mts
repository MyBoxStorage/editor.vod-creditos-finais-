import { exportCandidate } from "../src/services/candidateExportService.ts";

async function main() {
  const id = "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6";
  const t0 = Date.now();
  const r = await exportCandidate(id, {
    useSubtitles: true,
    subtitleRange: null,
    quality: "draft",
    speed: 1,
    preset: "vertical-split-9x16",
  });
  console.log(JSON.stringify({ path: r.prontosPath, ms: Date.now() - t0 }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
