"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipEffectInstance } from "../../../../../../lib/api";
import type { ClipTranscript } from "../../../../../../lib/api";
import { formatTime } from "../utils";
import { sourcePartDurationSeconds } from "../effectTiming";
import {
  applicationEnd,
  MIN_PRESET_APPLICATION_SEC,
  presetLabel,
  type PresetApplication,
} from "../presetApplications";

export type TimelineSelection =
  | { kind: "preset"; id: string }
  | { kind: "effect"; id: string }
  | null;

type TimelineTracksProps = {
  clipDuration: number;
  playheadTime: number;
  onSeek: (clipRelativeTime: number) => void;
  transcript: ClipTranscript | null;
  presetApplications: PresetApplication[];
  appliedEffects: ClipEffectInstance[];
  selection: TimelineSelection;
  onSelectPreset: (id: string) => void;
  onSelectEffect: (id: string) => void;
  onPresetChange: (id: string, start: number, end: number) => void;
  onPresetDragStart: () => void;
  onPresetDragEnd: () => void;
  onEffectChange: (
    id: string,
    patch: {
      clipTimestamp?: number;
      sourceTrimStart?: number;
      sourceTrimEnd?: number;
    }
  ) => void;
  onEffectDragStart: (id: string) => void;
  onEffectDragEnd: (id: string) => void;
};

const TRACK_LABEL_WIDTH = 72;
const TRACK_HEIGHT = 28;
const TRACK_GAP = 8;
const MIN_BLOCK_PX = 24;
const EDGE_HIT_PX = 10;

const TRACKS = [
  "vídeo",
  "legenda",
  "momentos",
  "efeitos",
  "áudio",
] as const;

type DragMode =
  | {
      kind: "preset-move";
      id: string;
      start0: number;
      end0: number;
      pointerX0: number;
    }
  | {
      kind: "preset-resize-start";
      id: string;
      start0: number;
      end0: number;
      pointerX0: number;
    }
  | {
      kind: "preset-resize-end";
      id: string;
      start0: number;
      end0: number;
      pointerX0: number;
    }
  | {
      kind: "effect-move";
      id: string;
      clipTs0: number;
      trimStart0: number;
      trimEnd0: number;
      pointerX0: number;
    }
  | {
      kind: "effect-resize-start";
      id: string;
      clipTs0: number;
      trimStart0: number;
      trimEnd0: number;
      pointerX0: number;
      maxSource: number;
    }
  | {
      kind: "effect-resize-end";
      id: string;
      clipTs0: number;
      trimStart0: number;
      trimEnd0: number;
      pointerX0: number;
      maxSource: number;
    };

function pct(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, (time / duration) * 100));
}

function widthPct(start: number, end: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(((end - start) / duration) * 100, 0.5);
}

/** Posição em px com largura mínima visual; o tempo real continua no início do bloco. */
function blockPx(
  startSec: number,
  endSec: number,
  duration: number,
  trackWidthPx: number
): { left: number; width: number } {
  if (!(trackWidthPx > 0 && duration > 0)) {
    return { left: 0, width: MIN_BLOCK_PX };
  }
  const left = (startSec / duration) * trackWidthPx;
  const realWidth = ((endSec - startSec) / duration) * trackWidthPx;
  return { left, width: Math.max(MIN_BLOCK_PX, realWidth) };
}

function useTrackWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function timeFromClientX(
  clientX: number,
  rect: DOMRect,
  clipDuration: number
): number {
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Number((ratio * clipDuration).toFixed(3));
}

export function TimelineTracks({
  clipDuration,
  playheadTime,
  onSeek,
  transcript,
  presetApplications,
  appliedEffects,
  selection,
  onSelectPreset,
  onSelectEffect,
  onPresetChange,
  onPresetDragStart,
  onPresetDragEnd,
  onEffectChange,
  onEffectDragStart,
  onEffectDragEnd,
}: TimelineTracksProps) {
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const [dragHint, setDragHint] = useState<string | null>(null);
  const trackWidthPx = useTrackWidth(trackAreaRef);

  const playheadPct = pct(playheadTime, clipDuration);
  const stackHeight = TRACK_HEIGHT * TRACKS.length + TRACK_GAP * (TRACKS.length - 1);

  const finishDrag = useCallback(() => {
    const mode = dragRef.current;
    dragRef.current = null;
    setDragHint(null);
    if (!mode) return;
    if (mode.kind.startsWith("preset-")) {
      onPresetDragEnd();
    } else if (mode.kind.startsWith("effect-") && "id" in mode) {
      onEffectDragEnd(mode.id);
    }
  }, [onPresetDragEnd, onEffectDragEnd]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const mode = dragRef.current;
      const area = trackAreaRef.current;
      if (!mode || !area || !(clipDuration > 0)) return;
      const rect = area.getBoundingClientRect();
      const t = timeFromClientX(e.clientX, rect, clipDuration);
      const deltaT = t - timeFromClientX(mode.pointerX0, rect, clipDuration);

      if (mode.kind === "preset-move") {
        const span = mode.end0 - mode.start0;
        let ns = mode.start0 + deltaT;
        ns = Math.max(0, Math.min(clipDuration - span, ns));
        const ne = ns + span;
        onPresetChange(mode.id, ns, ne);
        setDragHint(`${formatTime(ns)}–${formatTime(ne)}`);
      } else if (mode.kind === "preset-resize-start") {
        const ns = Math.max(
          0,
          Math.min(mode.end0 - MIN_PRESET_APPLICATION_SEC, mode.start0 + deltaT)
        );
        onPresetChange(mode.id, ns, mode.end0);
        setDragHint(`${formatTime(ns)}–${formatTime(mode.end0)}`);
      } else if (mode.kind === "preset-resize-end") {
        const ne = Math.min(
          clipDuration,
          Math.max(mode.start0 + MIN_PRESET_APPLICATION_SEC, mode.end0 + deltaT)
        );
        onPresetChange(mode.id, mode.start0, ne);
        setDragHint(`${formatTime(mode.start0)}–${formatTime(ne)}`);
      } else if (mode.kind === "effect-move") {
        const partDur = mode.trimEnd0 - mode.trimStart0;
        const maxStart = Math.max(0, clipDuration - partDur);
        const nts = Math.max(0, Math.min(maxStart, mode.clipTs0 + deltaT));
        onEffectChange(mode.id, { clipTimestamp: nts });
        setDragHint(`momento ${formatTime(nts)}`);
      } else if (mode.kind === "effect-resize-start") {
        const delta = deltaT;
        const nTrimStart = Math.max(
          0,
          Math.min(mode.trimEnd0 - 0.05, mode.trimStart0 + delta)
        );
        onEffectChange(mode.id, { sourceTrimStart: nTrimStart });
        setDragHint(
          `parte ${formatTime(nTrimStart)}–${formatTime(mode.trimEnd0)}`
        );
      } else if (mode.kind === "effect-resize-end") {
        const delta = deltaT;
        const nTrimEnd = Math.min(
          mode.maxSource,
          Math.max(mode.trimStart0 + 0.05, mode.trimEnd0 + delta)
        );
        onEffectChange(mode.id, { sourceTrimEnd: nTrimEnd });
        setDragHint(
          `parte ${formatTime(mode.trimStart0)}–${formatTime(nTrimEnd)}`
        );
      }
    },
    [clipDuration, onPresetChange, onEffectChange]
  );

  const onPointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    finishDrag();
  }, [onPointerMove, finishDrag]);

  function beginDrag(mode: DragMode) {
    if (mode.kind.startsWith("preset-")) {
      onPresetDragStart();
    } else if (mode.kind.startsWith("effect-") && "id" in mode) {
      onEffectDragStart(mode.id);
    }
    dragRef.current = mode;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    onSeek(Number((ratio * clipDuration).toFixed(3)));
  }

  function onPresetPointerDown(
    e: React.PointerEvent,
    app: PresetApplication,
    edge: "start" | "end" | "body"
  ) {
    e.stopPropagation();
    e.preventDefault();
    onSelectPreset(app.id);
    const end = applicationEnd(app);
    const pointerX0 = e.clientX;
    if (edge === "body") {
      beginDrag({
        kind: "preset-move",
        id: app.id,
        start0: app.inicio,
        end0: end,
        pointerX0,
      });
    } else if (edge === "start") {
      beginDrag({
        kind: "preset-resize-start",
        id: app.id,
        start0: app.inicio,
        end0: end,
        pointerX0,
      });
    } else {
      beginDrag({
        kind: "preset-resize-end",
        id: app.id,
        start0: app.inicio,
        end0: end,
        pointerX0,
      });
    }
  }

  function onEffectPointerDown(
    e: React.PointerEvent,
    inst: ClipEffectInstance,
    edge: "start" | "end" | "body"
  ) {
    e.stopPropagation();
    e.preventDefault();
    onSelectEffect(inst.id);
    const clipTs = inst.clipTimestamp ?? 0;
    const trimStart = inst.sourceTrimStart ?? 0;
    const trimEnd = inst.sourceTrimEnd ?? trimStart + 1;
    const maxSource =
      inst.libraryItem?.durationSeconds ??
      Math.max(trimEnd, trimStart + 1);
    const pointerX0 = e.clientX;
    if (edge === "body") {
      beginDrag({
        kind: "effect-move",
        id: inst.id,
        clipTs0: clipTs,
        trimStart0: trimStart,
        trimEnd0: trimEnd,
        pointerX0,
      });
    } else if (edge === "start") {
      beginDrag({
        kind: "effect-resize-start",
        id: inst.id,
        clipTs0: clipTs,
        trimStart0: trimStart,
        trimEnd0: trimEnd,
        pointerX0,
        maxSource,
      });
    } else {
      beginDrag({
        kind: "effect-resize-end",
        id: inst.id,
        clipTs0: clipTs,
        trimStart0: trimStart,
        trimEnd0: trimEnd,
        pointerX0,
        maxSource,
      });
    }
  }

  function renderBlockEdges(
    onStartDown: (e: React.PointerEvent) => void,
    onEndDown: (e: React.PointerEvent) => void
  ) {
    return (
      <>
        <div
          className="absolute top-0 bottom-0 z-20 cursor-ew-resize"
          style={{
            left: -EDGE_HIT_PX / 2,
            width: EDGE_HIT_PX,
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onStartDown(e);
          }}
        />
        <div
          className="absolute top-0 bottom-0 z-20 cursor-ew-resize"
          style={{
            right: -EDGE_HIT_PX / 2,
            width: EDGE_HIT_PX,
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onEndDown(e);
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-3">
      {dragHint && (
        <p className="text-center text-xs font-mono text-amber-200/90">
          {dragHint}
        </p>
      )}
      <div className="flex gap-2">
        <div
          className="flex shrink-0 flex-col justify-between pt-1.5 text-right text-[11px] text-zinc-500"
          style={{ width: TRACK_LABEL_WIDTH, height: stackHeight }}
        >
          {TRACKS.map((label) => (
            <div key={label} style={{ height: TRACK_HEIGHT }}>
              {label}
            </div>
          ))}
        </div>

        <div
          ref={trackAreaRef}
          className="relative flex-1"
          style={{ height: stackHeight }}
        >
          <div
            className="pointer-events-none absolute top-0 z-20 w-0.5 -translate-x-1/2 bg-white/90"
            style={{ left: `${playheadPct}%`, height: stackHeight }}
          />

          <div className="flex h-full flex-col" style={{ gap: TRACK_GAP }}>
            <div
              className="relative cursor-pointer rounded border border-zinc-800 bg-zinc-900/80"
              style={{ height: TRACK_HEIGHT }}
              onClick={seekFromEvent}
            >
              <div className="pointer-events-none absolute inset-y-1 left-0 right-0 rounded bg-zinc-600/70" />
            </div>

            <div
              className="relative cursor-pointer rounded border border-zinc-800 bg-zinc-900/80"
              style={{ height: TRACK_HEIGHT }}
              onClick={seekFromEvent}
            >
              {transcript?.segments.map((seg, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute top-1 bottom-1 rounded bg-zinc-500/60"
                  style={{
                    left: `${pct(seg.start, clipDuration)}%`,
                    width: `${widthPct(seg.start, seg.end, clipDuration)}%`,
                  }}
                  title={`#${i} ${formatTime(seg.start)}–${formatTime(seg.end)}`}
                />
              ))}
            </div>

            <div
              className="relative cursor-pointer rounded border border-zinc-800 bg-zinc-900/80"
              style={{ height: TRACK_HEIGHT }}
              onClick={seekFromEvent}
            >
              {presetApplications.map((app) => {
                const end = applicationEnd(app);
                const visualEnd = Math.max(end, app.inicio + MIN_PRESET_APPLICATION_SEC);
                const block = blockPx(
                  app.inicio,
                  visualEnd,
                  clipDuration,
                  trackWidthPx
                );
                const selected =
                  selection?.kind === "preset" && selection.id === app.id;
                return (
                  <div
                    key={app.id}
                    className={`absolute top-1 bottom-1 truncate rounded border px-1 text-[9px] leading-[22px] touch-none cursor-grab active:cursor-grabbing ${
                      selected
                        ? "border-amber-300 ring-1 ring-amber-400/60"
                        : "border-[#534AB7]"
                    } bg-[#AFA9EC]/55 text-[#2d2858]`}
                    style={{
                      left: block.left,
                      width: block.width,
                    }}
                    title={presetLabel(app.presetId)}
                    onPointerDown={(e) =>
                      onPresetPointerDown(e, app, "body")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPreset(app.id);
                    }}
                  >
                    {renderBlockEdges(
                      (e) => onPresetPointerDown(e, app, "start"),
                      (e) => onPresetPointerDown(e, app, "end")
                    )}
                    <span className="pointer-events-none block truncate">
                      {presetLabel(app.presetId)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              className="relative cursor-pointer rounded border border-zinc-800 bg-zinc-900/80"
              style={{ height: TRACK_HEIGHT }}
              onClick={seekFromEvent}
            >
              {appliedEffects.map((inst) => {
                const clipTs = inst.clipTimestamp ?? 0;
                const trimStart = inst.sourceTrimStart ?? 0;
                const trimEnd = inst.sourceTrimEnd ?? trimStart + 1;
                const partDur = sourcePartDurationSeconds(trimStart, trimEnd);
                const selected =
                  selection?.kind === "effect" && selection.id === inst.id;
                const effectBlock = blockPx(
                  clipTs,
                  clipTs + partDur,
                  clipDuration,
                  trackWidthPx
                );
                return (
                  <div
                    key={inst.id}
                    className={`absolute top-1 bottom-1 rounded border touch-none cursor-grab active:cursor-grabbing ${
                      selected
                        ? "border-amber-300 ring-1 ring-amber-400/60"
                        : "border-[#c47d12]"
                    } bg-[#EF9F27]/55`}
                    style={{
                      left: effectBlock.left,
                      width: effectBlock.width,
                    }}
                    title={
                      inst.libraryItem?.name ??
                      inst.effectLibraryItemId.slice(0, 8)
                    }
                    onPointerDown={(e) => onEffectPointerDown(e, inst, "body")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEffect(inst.id);
                    }}
                  >
                    {renderBlockEdges(
                      (e) => onEffectPointerDown(e, inst, "start"),
                      (e) => onEffectPointerDown(e, inst, "end")
                    )}
                  </div>
                );
              })}
            </div>

            <div
              className="relative cursor-pointer rounded border border-zinc-800 bg-zinc-900/80"
              style={{ height: TRACK_HEIGHT }}
              onClick={seekFromEvent}
            >
              <div className="pointer-events-none absolute inset-y-2 left-1 right-1 rounded bg-emerald-900/40" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <div style={{ width: TRACK_LABEL_WIDTH }} />
        <p className="text-xs text-zinc-400">
          {formatTime(playheadTime)} / {formatTime(clipDuration)}
        </p>
      </div>
    </div>
  );
}
