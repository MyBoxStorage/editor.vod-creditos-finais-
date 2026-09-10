import assert from "node:assert/strict";
import {
  chapterSelectionWindow,
  computeNavigationViewport,
  dragTimeFromAnchor,
  scrollWindowForPan,
  timeToX,
  xToTime,
  zoomSpanSec,
} from "./vodNavigationViewport";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`OK  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

test("full zoom spans entire VOD", () => {
  const vp = computeNavigationViewport(3200, "full", 800, 0);
  assert.equal(vp.windowSpanSec, 3200);
  assert.equal(vp.windowStartSec, 0);
});

test("10m zoom clamps window start", () => {
  const vp = computeNavigationViewport(3200, "10m", 800, 5000);
  assert.equal(vp.windowSpanSec, 600);
  assert.equal(vp.windowStartSec, 2600);
});

test("delta drag from frozen anchor", () => {
  const vp = computeNavigationViewport(100, "10s", 400, 0);
  const t = dragTimeFromAnchor(
    { pointerX: 200, timeSec: 5, pxPerSec: vp.pxPerSec },
    240,
    false
  );
  assert.ok(Math.abs(t - 6) < 0.05);
});

test("time and x round-trip in viewport", () => {
  const vp = computeNavigationViewport(100, "1m", 600, 10);
  const x = timeToX(25, vp);
  assert.ok(Math.abs(xToTime(x, vp) - 25) < 0.001);
});

test("chapter window T-40 T+20", () => {
  const w = chapterSelectionWindow(100, 40, 20, 500);
  assert.equal(w.startSec, 60);
  assert.equal(w.endSec, 120);
});

test("pan scroll respects bounds", () => {
  const vp = computeNavigationViewport(100, "10s", 400, 50);
  const next = scrollWindowForPan(vp, -2000, 100);
  assert.equal(next, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
