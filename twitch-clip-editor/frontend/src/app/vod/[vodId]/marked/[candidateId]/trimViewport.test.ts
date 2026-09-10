import assert from "node:assert/strict";
import {
  clampEndHandle,
  clampStartHandle,
  computeTrimBarLayout,
  deriveTrimDisplayTimes,
  dragTimeFromAnchor,
  intervalDuration,
  materialBarBounds,
  pctOnBar,
  selectionDiffers,
  type VodInterval,
} from "./trimViewport";

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

function approx(a: number, b: number, eps = 0.02) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${b} ±${eps}, got ${a}`);
}

const BAR_W = 800;

test("material bar uses full material duration", () => {
  const material: VodInterval = { startSec: 35.8, endSec: 56.7 };
  const { barStartSec, barEndSec } = materialBarBounds(material);
  const layout = computeTrimBarLayout(barStartSec, barEndSec, BAR_W);
  approx(barEndSec - barStartSec, 20.9, 0.01);
  assert.equal(pctOnBar(material.startSec, layout), 0);
  assert.equal(pctOnBar(material.endSec, layout), 100);
});

test("selection inside material shows excluded regions", () => {
  const material: VodInterval = { startSec: 100, endSec: 120.9 };
  const selection: VodInterval = { startSec: 105, endSec: 115 };
  const times = deriveTrimDisplayTimes(material, selection);
  approx(times.excludedHead, 5, 0.01);
  approx(times.excludedTail, 5.9, 0.01);
  assert.ok(selectionDiffers(material, selection));
});

test("drag delta from frozen anchor", () => {
  const layout = computeTrimBarLayout(100, 120.9, BAR_W);
  const t = dragTimeFromAnchor(
    { pointerX: 400, timeSec: 115, pxPerSec: layout.pxPerSec },
    360,
    false
  );
  approx(t - 115, -40 / layout.pxPerSec, 0.05);
});

test("handles clamped to material bounds", () => {
  const material: VodInterval = { startSec: 10, endSec: 30 };
  const selection: VodInterval = { startSec: 12, endSec: 28 };
  const start = clampStartHandle(9, selection, material.startSec);
  assert.equal(start, 10);
  const end = clampEndHandle(31, selection, material.endSec);
  assert.equal(end, 30);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
