/**
 * Apply library SFX via API and export via exportCandidate — validates pipeline.
 */
import fs from "fs";
import { initDb } from "../src/db/index.js";
import { getDb } from "../src/db/index.js";
import { exportCandidate } from "../src/services/candidateExportService.js";
import { listEffectsForClip } from "../src/services/effectsLibraryService.js";

initDb();

const API = process.env.API_BASE ?? "http://localhost:3001";

const candidate = getDb()
  .prepare("SELECT id FROM candidates ORDER BY created_at DESC LIMIT 1")
  .get() as { id: string } | undefined;

if (!candidate) {
  console.error("No candidate");
  process.exit(1);
}

const browse = await fetch(`${API}/effects-library/browse?type=sfx&limit=1&sort=mostUsed`);
const { items } = (await browse.json()) as {
  items: Array<{ id: string; name: string }>;
};
const sfx = items[0]!;

const applyRes = await fetch(`${API}/candidates/${candidate.id}/effects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    effectLibraryItemId: sfx.id,
    sourceTrimStart: 0,
    sourceTrimEnd: 1.5,
    clipTimestamp: 0.5,
    volume: 0.85,
  }),
});
if (!applyRes.ok) {
  console.error("apply failed", await applyRes.text());
  process.exit(1);
}

const effects = await listEffectsForClip(candidate.id);
const applied = effects.find((e) => e.effectLibraryItemId === sfx.id);
if (!applied) {
  console.error("effect not listed after apply");
  process.exit(1);
}

const result = await exportCandidate(candidate.id, {
  useSubtitles: false,
  subtitleRange: null,
  quality: "draft",
  speed: 1,
  preset: "vertical-split-9x16",
});

if (!result.prontosPath || !fs.existsSync(result.prontosPath)) {
  console.error("export file missing", result);
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    candidateId: candidate.id,
    effectName: sfx.name,
    clipTimestamp: applied.clipTimestamp,
    exportPath: result.prontosPath,
    bytes: fs.statSync(result.prontosPath).size,
  })
);
