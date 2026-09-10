import { previewRenderWindow } from "../src/services/previewRenderService.ts";

const ID = "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6";
const base = {
  useSubtitles: true,
  subtitleRange: null,
  quality: "draft" as const,
  speed: 1,
  preset: "vertical-split-9x16",
  windowStart: 0,
  windowEnd: 8,
};

const snap = {
  settings: {
    style: "active_word" as const,
    uppercase: false,
    highlightColor: "#FFD93D",
    fontSize: 72,
    positionPercent: 68,
    outlineWidth: 8,
  },
  segments: [
    {
      text: "Galera cache test",
      start: 0,
      end: 3,
      words: [
        { word: "Galera", start: 0, end: 1 },
        { word: "cache", start: 1, end: 2 },
        { word: "test", start: 2, end: 3 },
      ],
    },
  ],
};

const r1 = await previewRenderWindow(ID, { ...base, subtitleSnapshot: snap });
const r2 = await previewRenderWindow(ID, { ...base, subtitleSnapshot: snap });
const r3 = await previewRenderWindow(ID, {
  ...base,
  subtitleSnapshot: {
    ...snap,
    segments: [{ ...snap.segments[0], text: "Alterado cache test" }],
  },
});
console.log(
  JSON.stringify({
    firstCached: r1.cached,
    secondCached: r2.cached,
    changedCached: r3.cached,
    samePath: r1.previewRelativePath === r2.previewRelativePath,
    diffPath: r1.previewRelativePath !== r3.previewRelativePath,
  })
);
