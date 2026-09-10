/**
 * Timeline join filters — video concat/xfade + audio adelay/amix (C3).
 */

import type { ResolvedJoin } from "./compositionJoinSettings";

function ms(sec: number): number {
  return Math.max(0, Math.round(sec * 1000));
}

export type JoinGraphInput = {
  segmentVideoLabels: string[];
  segmentAudioLabels: string[];
  segmentDurations: number[];
  resolvedJoins: ResolvedJoin[];
};

export type JoinGraphOutput = {
  filterParts: string[];
  videoOutLabel: string;
  audioOutLabel: string;
  totalDurationSec: number;
  warnings: string[];
};

function buildVideoJoin(
  labels: string[],
  durations: number[],
  joins: ResolvedJoin[]
): { parts: string[]; outLabel: string; totalDur: number } {
  if (labels.length === 1) {
    return { parts: [], outLabel: labels[0], totalDur: durations[0] ?? 0 };
  }

  const parts: string[] = [];
  let current = labels[0];
  let currentDur = durations[0];
  let idx = 0;

  for (let j = 0; j < joins.length; j++) {
    const join = joins[j];
    const next = labels[j + 1];
    const nextDur = durations[j + 1];
    const out = `vjoin${idx++}`;

    if (join.videoTransition !== "cut" && join.videoTransitionSec > 0.01) {
      const d = join.videoTransitionSec;
      const offset = Math.max(0, currentDur - d);
      const transition =
        join.videoTransition === "dissolve" ? "dissolve" : "fade";
      parts.push(
        `[${current}][${next}]xfade=transition=${transition}:duration=${d.toFixed(4)}:offset=${offset.toFixed(4)}[${out}]`
      );
      currentDur = currentDur + nextDur - d;
    } else {
      parts.push(`[${current}][${next}]concat=n=2:v=1:a=0[${out}]`);
      currentDur = currentDur + nextDur;
    }
    current = out;
  }

  return {
    parts,
    outLabel: current,
    totalDur: Number(currentDur.toFixed(3)),
  };
}

function buildAudioJoin(
  labels: string[],
  durations: number[],
  joins: ResolvedJoin[]
): { parts: string[]; outLabel: string } {
  if (labels.length === 1) {
    return { parts: [], outLabel: labels[0] };
  }

  const allHard = joins.every((j) => j.audioMode === "hard");
  if (allHard) {
    const concatIn = labels.map((l) => `[${l}]`).join("");
    return {
      parts: [`${concatIn}concat=n=${labels.length}:v=0:a=1[aout]`],
      outLabel: "aout",
    };
  }

  const parts: string[] = [];
  const mixedLabels: string[] = [];

  for (let i = 0; i < labels.length; i++) {
    let chain = `[${labels[i]}]`;
    const dur = durations[i];
    const fades: string[] = [];

    if (i > 0) {
      const prevJoin = joins[i - 1];
      const o = prevJoin.effectiveOverlapSec;
      if (prevJoin.audioMode === "cross" && o > 0.01) {
        fades.push(`afade=t=in:st=0:d=${o.toFixed(4)}`);
      }
    }
    if (i < joins.length) {
      const join = joins[i];
      const o = join.effectiveOverlapSec;
      if (join.audioMode === "cross" && o > 0.01) {
        fades.push(
          `afade=t=out:st=${Math.max(0, dur - o).toFixed(4)}:d=${o.toFixed(4)}`
        );
      }
    }
    if (fades.length) {
      chain += fades.join(",");
    }

    let offsetSec = durations.slice(0, i).reduce((a, b) => a + b, 0);
    if (i > 0) {
      const prevJoin = joins[i - 1];
      if (
        prevJoin.audioMode === "j-cut" ||
        prevJoin.audioMode === "cross"
      ) {
        offsetSec -= prevJoin.effectiveOverlapSec;
      }
    }

    const delayed = `ad${i}`;
    const adelayFilter = `adelay=${ms(offsetSec)}|${ms(offsetSec)}`;
    if (fades.length) {
      parts.push(`${chain},${adelayFilter}[${delayed}]`);
    } else {
      parts.push(`[${labels[i]}]${adelayFilter}[${delayed}]`);
    }
    mixedLabels.push(`[${delayed}]`);
  }

  const totalVideoDur = durations.reduce((a, b) => a + b, 0);
  parts.push(
    `${mixedLabels.join("")}amix=inputs=${mixedLabels.length}:duration=longest:dropout_transition=0:normalize=0[aout_raw]`
  );
  parts.push(
    `[aout_raw]atrim=0:${totalVideoDur.toFixed(4)},asetpts=PTS-STARTPTS[aout]`
  );

  return { parts, outLabel: "aout" };
}

export function buildTimelineJoinGraph(input: JoinGraphInput): JoinGraphOutput {
  const warnings = input.resolvedJoins.flatMap((j) => j.warnings);
  const video = buildVideoJoin(
    input.segmentVideoLabels,
    input.segmentDurations,
    input.resolvedJoins
  );
  const audio = buildAudioJoin(
    input.segmentAudioLabels,
    input.segmentDurations,
    input.resolvedJoins
  );

  return {
    filterParts: [...video.parts, ...audio.parts],
    videoOutLabel: video.outLabel,
    audioOutLabel: audio.outLabel,
    totalDurationSec: video.totalDur,
    warnings,
  };
}
