/** Validates fixed-scale trim bar: end handle drag-left shortens selection. */
import {
  computeTrimBarLayout,
  dragTimeFromAnchor,
  type VodInterval,
} from "../../frontend/src/app/vod/[vodId]/marked/[candidateId]/trimViewport.ts";

const interval: VodInterval = { startSec: 226, endSec: 316 };
const layout = computeTrimBarLayout(226, 316, 800);
const anchorX = 100 + 400;
const anchorTime = interval.endSec;
const afterX = anchorX - 120;
const t = dragTimeFromAnchor(
  { pointerX: anchorX, timeSec: anchorTime, pxPerSec: layout.pxPerSec },
  afterX,
  false
);
const delta = t - interval.endSec;
console.log(
  JSON.stringify({
    start: interval.startSec,
    endBefore: interval.endSec,
    endAfterDrag: t,
    deltaSec: Number(delta.toFixed(2)),
    shortens: delta < 0,
    ok: delta < 0 && Math.abs(delta) > 1,
  })
);
