import type { TranscriptWord } from "./transcribeService";

export type SegmentTimingStatus = "original" | "partial" | "redistributed";

export type WordTimingEditResult = {
  words: TranscriptWord[];
  timingStatus: SegmentTimingStatus;
};

export type WordSubstitution = { from: string; to: string };

/** Normalize for spoken-word comparison: lowercase, strip accents and punctuation. */
export function normalizeSpokenWord(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

/** Split segment text into display tokens (preserves user spacing/punctuation). */
export function tokenizeSegmentText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

type AlignOp =
  | { type: "equal"; oldIdx: number; newIdx: number }
  | { type: "replace"; oldIdx: number; newIdx: number }
  | { type: "insert"; newIdx: number }
  | { type: "delete"; oldIdx: number };

/** LCS diff producing equal/replace/insert/delete ops. */
export function diffWordTokens(oldTokens: string[], newTokens: string[]): AlignOp[] {
  const a = oldTokens.map(normalizeSpokenWord);
  const b = newTokens.map(normalizeSpokenWord);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: Array<{ oldIdx: number | null; newIdx: number | null }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ oldIdx: i, newIdx: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ oldIdx: i, newIdx: null });
      i++;
    } else {
      raw.push({ oldIdx: null, newIdx: j });
      j++;
    }
  }
  while (i < n) {
    raw.push({ oldIdx: i, newIdx: null });
    i++;
  }
  while (j < m) {
    raw.push({ oldIdx: null, newIdx: j });
    j++;
  }

  const ops: AlignOp[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    if (cur.oldIdx != null && cur.newIdx != null) {
      ops.push({ type: "equal", oldIdx: cur.oldIdx, newIdx: cur.newIdx });
    } else if (cur.oldIdx != null && cur.newIdx == null) {
      const next = raw[k + 1];
      if (next != null && next.oldIdx == null && next.newIdx != null) {
        ops.push({ type: "replace", oldIdx: cur.oldIdx, newIdx: next.newIdx });
        k++;
      } else {
        ops.push({ type: "delete", oldIdx: cur.oldIdx });
      }
    } else if (cur.oldIdx == null && cur.newIdx != null) {
      ops.push({ type: "insert", newIdx: cur.newIdx });
    }
  }
  return ops;
}

/** Substitutions detected between two segment texts (for glossary offers). */
export function findWordSubstitutions(
  oldText: string,
  newText: string
): WordSubstitution[] {
  const oldTokens = tokenizeSegmentText(oldText);
  const newTokens = tokenizeSegmentText(newText);
  const ops = diffWordTokens(oldTokens, newTokens);
  const out: WordSubstitution[] = [];
  for (const op of ops) {
    if (op.type === "replace") {
      const from = oldTokens[op.oldIdx];
      const to = newTokens[op.newIdx];
      if (from && to && normalizeSpokenWord(from) !== normalizeSpokenWord(to)) {
        out.push({ from, to });
      }
    }
  }
  return out;
}

function redistributeProportional(
  newTokens: string[],
  segStart: number,
  segEnd: number
): TranscriptWord[] {
  const duration = Math.max(0.05, segEnd - segStart);
  const weights = newTokens.map((t) => Math.max(1, normalizeSpokenWord(t).length));
  const total = weights.reduce((s, w) => s + w, 0);
  let cursor = segStart;
  return newTokens.map((token, idx) => {
    const share = (weights[idx] / total) * duration;
    const start = Number(cursor.toFixed(3));
    const end =
      idx === newTokens.length - 1
        ? Number(segEnd.toFixed(3))
        : Number((cursor + share).toFixed(3));
    cursor = end;
    return { word: token, start, end };
  });
}

function splitInterval(
  start: number,
  end: number,
  count: number
): Array<{ start: number; end: number }> {
  if (count <= 0) return [];
  const duration = Math.max(0.01, end - start);
  const step = duration / count;
  const slots: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    const s = Number((start + step * i).toFixed(3));
    const e =
      i === count - 1
        ? Number(end.toFixed(3))
        : Number((start + step * (i + 1)).toFixed(3));
    slots.push({ start: s, end: e });
  }
  return slots;
}

function applyDeleteAbsorption(
  result: TranscriptWord[],
  oldWords: TranscriptWord[],
  ops: AlignOp[]
): void {
  const deletes = ops.filter((o) => o.type === "delete");
  if (deletes.length === 0) return;

  // Map old index → new index for preserved words
  const oldToNew = new Map<number, number>();
  for (const op of ops) {
    if (op.type === "equal" || op.type === "replace") {
      oldToNew.set(op.oldIdx, op.newIdx);
    }
  }

  for (const del of deletes) {
    const removed = oldWords[del.oldIdx];
    if (!removed) continue;

    // Prefer absorb into previous preserved word
    let prevNewIdx: number | null = null;
    for (let oi = del.oldIdx - 1; oi >= 0; oi--) {
      if (oldToNew.has(oi)) {
        prevNewIdx = oldToNew.get(oi)!;
        break;
      }
    }

    if (prevNewIdx != null && result[prevNewIdx]) {
      result[prevNewIdx].end = Number(
        Math.max(result[prevNewIdx].end, removed.end).toFixed(3)
      );
      continue;
    }

    // First word removed: pull start of next preserved word backward
    let nextNewIdx: number | null = null;
    for (let oi = del.oldIdx + 1; oi < oldWords.length; oi++) {
      if (oldToNew.has(oi)) {
        nextNewIdx = oldToNew.get(oi)!;
        break;
      }
    }
    if (nextNewIdx != null && result[nextNewIdx]) {
      result[nextNewIdx].start = Number(
        Math.min(result[nextNewIdx].start, removed.start).toFixed(3)
      );
    }
  }

  // Chain consecutive deletes into one previous word (extend through all removed)
  for (const del of deletes) {
    const removed = oldWords[del.oldIdx];
    if (!removed) continue;
    let prevNewIdx: number | null = null;
    for (let oi = del.oldIdx - 1; oi >= 0; oi--) {
      if (oldToNew.has(oi)) {
        prevNewIdx = oldToNew.get(oi)!;
        break;
      }
    }
    if (prevNewIdx != null && result[prevNewIdx]) {
      result[prevNewIdx].end = Number(
        Math.max(result[prevNewIdx].end, removed.end).toFixed(3)
      );
    }
  }
}

/**
 * Reconcile word timings after a segment text edit.
 */
export function reconcileSegmentWordTimings(
  oldWords: TranscriptWord[],
  newText: string,
  segStart: number,
  segEnd: number
): WordTimingEditResult {
  const newTokens = tokenizeSegmentText(newText);
  if (newTokens.length === 0) {
    return { words: [], timingStatus: "original" };
  }

  const oldTokens = oldWords.map((w) => w.word.trim());
  if (oldWords.length === 0) {
    return {
      words: redistributeProportional(newTokens, segStart, segEnd),
      timingStatus: "redistributed",
    };
  }

  const ops = diffWordTokens(oldTokens, newTokens);
  const equalCount = ops.filter((o) => o.type === "equal").length;
  if (equalCount === 0 && ops.every((o) => o.type !== "replace")) {
    return {
      words: redistributeProportional(newTokens, segStart, segEnd),
      timingStatus: "redistributed",
    };
  }

  const result: TranscriptWord[] = new Array(newTokens.length);
  let preserved = 0;
  let estimated = 0;

  for (const op of ops) {
    if (op.type === "equal") {
      const ow = oldWords[op.oldIdx];
      result[op.newIdx] = {
        word: newTokens[op.newIdx],
        start: ow.start,
        end: ow.end,
      };
      preserved++;
    } else if (op.type === "replace") {
      const ow = oldWords[op.oldIdx];
      result[op.newIdx] = {
        word: newTokens[op.newIdx],
        start: ow.start,
        end: ow.end,
      };
      estimated++;
    }
  }

  applyDeleteAbsorption(result, oldWords, ops);

  // Inserts: split gap between neighboring preserved timings
  const inserts = ops.filter((o) => o.type === "insert");
  let run: number[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const firstIdx = run[0];
    const lastIdx = run[run.length - 1];
    const prev = firstIdx > 0 ? result[firstIdx - 1] : null;
    const next = result.slice(lastIdx + 1).find(Boolean) ?? null;
    const gapStart = prev?.end ?? segStart;
    const gapEnd = next?.start ?? segEnd;
    const slots = splitInterval(gapStart, gapEnd, run.length);
    run.forEach((newIdx, i) => {
      result[newIdx] = {
        word: newTokens[newIdx],
        start: slots[i].start,
        end: slots[i].end,
      };
      estimated++;
    });
    run = [];
  };

  for (let i = 0; i < inserts.length; i++) {
    run.push(inserts[i].newIdx);
    const next = inserts[i + 1];
    if (!next || next.newIdx !== inserts[i].newIdx + 1) {
      flushRun();
    }
  }
  flushRun();

  for (let i = 0; i < newTokens.length; i++) {
    if (!result[i]) {
      const prev = i > 0 ? result[i - 1] : null;
      const next = result.slice(i + 1).find(Boolean) ?? null;
      const start = prev?.end ?? segStart;
      const end = next?.start ?? segEnd;
      result[i] = {
        word: newTokens[i],
        start,
        end: Math.max(start + 0.05, end),
      };
      estimated++;
    }
  }

  for (let i = 1; i < result.length; i++) {
    if (result[i].start < result[i - 1].end) {
      result[i].start = result[i - 1].end;
    }
    if (result[i].end <= result[i].start) {
      result[i].end = Number((result[i].start + 0.05).toFixed(3));
    }
  }

  const timingStatus: SegmentTimingStatus =
    estimated === 0
      ? "original"
      : preserved > 0
        ? "partial"
        : "redistributed";

  return { words: result, timingStatus };
}

/** Map highlight indices from old tokens to new via diff pairing. */
export function remapHighlightedWordIndices(
  oldWords: TranscriptWord[],
  oldHighlights: number[],
  newText: string
): number[] {
  const newTokens = tokenizeSegmentText(newText);
  if (oldHighlights.length === 0 || newTokens.length === 0) return [];
  const oldTokens = oldWords.map((w) => w.word.trim());
  const ops = diffWordTokens(oldTokens, newTokens);
  const mapped = new Set<number>();
  for (const op of ops) {
    if (
      (op.type === "equal" || op.type === "replace") &&
      oldHighlights.includes(op.oldIdx)
    ) {
      mapped.add(op.newIdx);
    }
  }
  return [...mapped].sort((a, b) => a - b);
}
