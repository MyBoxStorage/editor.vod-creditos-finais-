"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipSegment } from "../../../../../../lib/api";
import { formatClipTime } from "../../../../../../lib/finalizationTime";
import { MIN_BLOCK_PX } from "./SubtitleTrack";

export const EDGE_HIT_PX = 10;
const MIN_TRIM_SEC = 0.5;

export type DragAnchor = {
  pointerX: number;
  timeSec: number;
  pxPerSec: number;
};

export type CompositionSegmentView = {
  orderIndex: number;
  clipSegment: ClipSegment;
  durationSec: number;
  timelineStart: number;
};

type DraftInterval = {
  segmentId: string;
  sourceStart: number;
  sourceEnd: number;
};

type SequenceTimelineProps = {
  segments: CompositionSegmentView[];
  totalDuration: number;
  playheadTime: number;
  activeSegmentId: string | null;
  draftInterval: DraftInterval | null;
  onSeek: (time: number) => void;
  onReorder: (clipSegmentIds: string[]) => void;
  onTrimCommit: (
    segmentId: string,
    sourceStart: number,
    sourceEnd: number
  ) => void;
  onTrimDraft: (draft: DraftInterval | null) => void;
  onTrimUndoPush: (segmentId: string, sourceStart: number, sourceEnd: number) => void;
  onBeforeTrim: (segmentId: string) => Promise<boolean>;
  /** Hook block duration shown at position 0 (export timeline). */
  hookDisplaySec?: number;
  hookSourceStart?: number;
  hookSourceEnd?: number;
  hookMarkingActive?: boolean;
  onHookRangeCommit?: (startSec: number, endSec: number) => void;
  hookSelectDraft?: { start: number; end: number } | null;
  onHookSelectDraft?: (draft: { start: number; end: number } | null) => void;
};

type DragMode =
  | {
      kind: "trim-start";
      segmentId: string;
      anchor: DragAnchor;
      baseStart: number;
      baseEnd: number;
      materialStart: number;
    }
  | {
      kind: "trim-end";
      segmentId: string;
      anchor: DragAnchor;
      baseStart: number;
      baseEnd: number;
      materialEnd: number;
    }
  | {
      kind: "reorder";
      segmentId: string;
      pointerX0: number;
      dropIndex: number;
    }
  | {
      kind: "hook-select";
      anchor: DragAnchor;
      startSec: number;
      endSec: number;
    };

function dragTimeFromAnchor(anchor: DragAnchor, currentPointerX: number): number {
  const deltaPx = currentPointerX - anchor.pointerX;
  return anchor.timeSec + deltaPx / anchor.pxPerSec;
}

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

function effectiveSegment(
  seg: CompositionSegmentView,
  draft: DraftInterval | null
): { start: number; end: number; duration: number } {
  const cs = seg.clipSegment;
  const start =
    draft?.segmentId === cs.id ? draft.sourceStart : cs.sourceStart;
  const end = draft?.segmentId === cs.id ? draft.sourceEnd : cs.sourceEnd;
  return {
    start,
    end,
    duration: Math.max(MIN_TRIM_SEC, end - start),
  };
}

export function SequenceTimeline({
  segments,
  totalDuration,
  playheadTime,
  activeSegmentId,
  draftInterval,
  onSeek,
  onReorder,
  onTrimCommit,
  onTrimDraft,
  onTrimUndoPush,
  onBeforeTrim,
  hookDisplaySec = 0,
  hookSourceStart,
  hookSourceEnd,
  hookMarkingActive = false,
  onHookRangeCommit,
  hookSelectDraft,
  onHookSelectDraft,
}: SequenceTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const draftIntervalRef = useRef<DraftInterval | null>(null);
  const trackWidthPx = useTrackWidth(trackRef);
  const [reorderGhostIndex, setReorderGhostIndex] = useState<number | null>(
    null
  );

  const displayDuration = totalDuration + hookDisplaySec;

  const pxPerSec =
    displayDuration > 0 && trackWidthPx > 0
      ? trackWidthPx / displayDuration
      : 1;

  const contentTimeFromClientX = useCallback(
    (clientX: number): number | null => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !(totalDuration > 0)) return null;
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
      );
      const t = ratio * displayDuration;
      const contentT = t - hookDisplaySec;
      return Math.max(0, Math.min(totalDuration, contentT));
    },
    [displayDuration, hookDisplaySec, totalDuration]
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const mode = dragRef.current;
      if (!mode) return;

      if (mode.kind === "hook-select") {
        let t = dragTimeFromAnchor(mode.anchor, e.clientX);
        t = Math.max(0, Math.min(totalDuration, t));
        const start = Math.min(mode.startSec, t);
        const end = Math.max(mode.startSec, t);
        onHookSelectDraft?.({ start, end });
        dragRef.current = { ...mode, endSec: end };
        return;
      }

      if (mode.kind === "reorder") {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || !(totalDuration > 0)) return;
        const ratio = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / rect.width)
        );
        const t = ratio * totalDuration;
        let acc = 0;
        let idx = segments.length - 1;
        for (let i = 0; i < segments.length; i++) {
          const dur = segments[i].durationSec;
          if (t < acc + dur / 2) {
            idx = i;
            break;
          }
          acc += dur;
        }
        setReorderGhostIndex(idx);
        dragRef.current = { ...mode, dropIndex: idx };
        return;
      }

      const seg = segments.find((s) => s.clipSegment.id === mode.segmentId);
      if (!seg) return;

      if (mode.kind === "trim-start") {
        let t = dragTimeFromAnchor(mode.anchor, e.clientX);
        t = Math.max(
          mode.materialStart,
          Math.min(t, mode.baseEnd - MIN_TRIM_SEC)
        );
        const draft = {
          segmentId: mode.segmentId,
          sourceStart: Number(t.toFixed(3)),
          sourceEnd: mode.baseEnd,
        };
        draftIntervalRef.current = draft;
        onTrimDraft(draft);
      } else {
        let t = dragTimeFromAnchor(mode.anchor, e.clientX);
        t = Math.min(
          mode.materialEnd,
          Math.max(t, mode.baseStart + MIN_TRIM_SEC)
        );
        const draft = {
          segmentId: mode.segmentId,
          sourceStart: mode.baseStart,
          sourceEnd: Number(t.toFixed(3)),
        };
        draftIntervalRef.current = draft;
        onTrimDraft(draft);
      }
    },
    [onHookSelectDraft, onTrimDraft, segments, totalDuration]
  );

  const handlePointerUp = useCallback(async () => {
    const mode = dragRef.current;
    if (!mode) return;
    dragRef.current = null;
    setReorderGhostIndex(null);

    if (mode.kind === "hook-select") {
      onHookSelectDraft?.(null);
      const start = Math.min(mode.startSec, mode.endSec);
      const end = Math.max(mode.startSec, mode.endSec);
      if (end - start >= 0.05) {
        onHookRangeCommit?.(Number(start.toFixed(3)), Number(end.toFixed(3)));
      }
      return;
    }

    if (mode.kind === "reorder") {
      const fromIdx = segments.findIndex(
        (s) => s.clipSegment.id === mode.segmentId
      );
      const toIdx = mode.dropIndex;
      if (fromIdx < 0 || fromIdx === toIdx) return;
      const ids = segments.map((s) => s.clipSegment.id);
      const [moved] = ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, moved);
      onReorder(ids);
      return;
    }

    const draft = draftIntervalRef.current;
    draftIntervalRef.current = null;
    onTrimDraft(null);
    if (!draft || draft.segmentId !== mode.segmentId) return;

    const seg = segments.find((s) => s.clipSegment.id === mode.segmentId);
    if (!seg) return;

    const cs = seg.clipSegment;
    if (
      Math.abs(draft.sourceStart - cs.sourceStart) < 0.02 &&
      Math.abs(draft.sourceEnd - cs.sourceEnd) < 0.02
    ) {
      return;
    }

    const ok = await onBeforeTrim(mode.segmentId);
    if (!ok) return;

    onTrimUndoPush(cs.id, cs.sourceStart, cs.sourceEnd);
    onTrimCommit(draft.segmentId, draft.sourceStart, draft.sourceEnd);
  }, [onBeforeTrim, onHookRangeCommit, onHookSelectDraft, onReorder, onTrimCommit, onTrimDraft, onTrimUndoPush, segments]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = () => {
      void handlePointerUp();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  function seekFromEvent(e: React.MouseEvent) {
    if (hookMarkingActive) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !(displayDuration > 0)) return;
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width)
    );
    const t = ratio * displayDuration;
    if (t < hookDisplaySec) {
      onSeek(0);
    } else {
      onSeek(Number((t - hookDisplaySec).toFixed(3)));
    }
  }

  function onTrackPointerDown(e: React.PointerEvent) {
    if (!hookMarkingActive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const contentT = contentTimeFromClientX(e.clientX);
    if (contentT === null) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const anchor: DragAnchor = {
      pointerX: e.clientX,
      timeSec: contentT,
      pxPerSec,
    };
    dragRef.current = {
      kind: "hook-select",
      anchor,
      startSec: contentT,
      endSec: contentT,
    };
    onHookSelectDraft?.({ start: contentT, end: contentT });
  }

  function onTrimStartDown(
    seg: CompositionSegmentView,
    e: React.PointerEvent,
    eff: { start: number; end: number }
  ) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const materialStart =
      seg.clipSegment.originalSourceStart ?? seg.clipSegment.sourceStart;
    const anchor: DragAnchor = {
      pointerX: e.clientX,
      timeSec: eff.start,
      pxPerSec,
    };
    dragRef.current = {
      kind: "trim-start",
      segmentId: seg.clipSegment.id,
      anchor,
      baseStart: eff.start,
      baseEnd: eff.end,
      materialStart,
    };
  }

  function onTrimEndDown(
    seg: CompositionSegmentView,
    e: React.PointerEvent,
    eff: { start: number; end: number }
  ) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const materialEnd =
      seg.clipSegment.originalSourceEnd ?? seg.clipSegment.sourceEnd;
    const anchor: DragAnchor = {
      pointerX: e.clientX,
      timeSec: eff.end,
      pxPerSec,
    };
    dragRef.current = {
      kind: "trim-end",
      segmentId: seg.clipSegment.id,
      anchor,
      baseStart: eff.start,
      baseEnd: eff.end,
      materialEnd,
    };
  }

  function onBodyDown(seg: CompositionSegmentView, e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const fromIdx = segments.findIndex(
      (s) => s.clipSegment.id === seg.clipSegment.id
    );
    dragRef.current = {
      kind: "reorder",
      segmentId: seg.clipSegment.id,
      pointerX0: e.clientX,
      dropIndex: fromIdx,
    };
    setReorderGhostIndex(fromIdx);
  }

  const playheadLeft =
    displayDuration > 0
      ? ((playheadTime + hookDisplaySec) / displayDuration) * trackWidthPx
      : 0;

  const hookBlock = hookDisplaySec > 0.01 ? blockPx(0, hookDisplaySec, displayDuration, trackWidthPx) : null;

  const hookMarkOverlay =
    hookSelectDraft ??
    (hookSourceStart != null && hookSourceEnd != null
      ? { start: hookSourceStart, end: hookSourceEnd }
      : null);

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>sequência{hookMarkingActive ? " · marque o hook" : ""}</span>
        <span>{formatClipTime(displayDuration)} total</span>
      </div>

      <div
        ref={trackRef}
        className={`relative h-12 rounded border border-zinc-800 bg-zinc-900/80 touch-none ${
          hookMarkingActive ? "cursor-crosshair" : "cursor-pointer"
        }`}
        onClick={seekFromEvent}
        onPointerDown={onTrackPointerDown}
      >
        {hookBlock && (
          <div
            className="absolute top-1 bottom-1 z-[5] flex items-center justify-center overflow-hidden rounded border-2 border-dashed border-fuchsia-400 bg-fuchsia-900/50 text-[10px] text-fuchsia-100"
            style={{ left: hookBlock.left, width: hookBlock.width }}
            title={`hook ${formatClipTime(hookDisplaySec)} (repetido)`}
          >
            ⚡ hook
          </div>
        )}

        {hookMarkOverlay && (
          <div
            className="pointer-events-none absolute top-1 bottom-1 z-[6] rounded border border-amber-400/80 bg-amber-500/25"
            style={{
              ...blockPx(
                hookMarkOverlay.start + hookDisplaySec,
                hookMarkOverlay.end + hookDisplaySec,
                displayDuration,
                trackWidthPx
              ),
            }}
          />
        )}

        {reorderGhostIndex !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-fuchsia-400"
            style={{
              left:
                (hookDisplaySec +
                  segments
                    .slice(0, reorderGhostIndex)
                    .reduce((s, seg) => s + seg.durationSec, 0)) *
                (trackWidthPx / Math.max(displayDuration, 0.001)),
            }}
          />
        )}

        <div
          className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-white/90"
          style={{ left: playheadLeft }}
        />

        {segments.map((seg, i) => {
          const eff = effectiveSegment(seg, draftInterval);
          const { left, width } = blockPx(
            seg.timelineStart + hookDisplaySec,
            seg.timelineStart + hookDisplaySec + seg.durationSec,
            displayDuration,
            trackWidthPx
          );
          const isActive = seg.clipSegment.id === activeSegmentId;
          const isDraft = draftInterval?.segmentId === seg.clipSegment.id;

          return (
            <div
              key={seg.clipSegment.id}
              className={`absolute top-1 bottom-1 flex items-center overflow-hidden rounded border text-[10px] ${
                isActive
                  ? "border-sky-400 bg-sky-600/60 text-white"
                  : isDraft
                    ? "border-amber-400 bg-amber-700/50 text-amber-50"
                    : "border-zinc-600 bg-zinc-600/70 text-zinc-200"
              }`}
              style={{ left, width }}
              title={`#${i + 1} ${formatClipTime(eff.duration)}`}
            >
              <div
                className="absolute top-0 bottom-0 z-20 cursor-ew-resize"
                style={{ left: -EDGE_HIT_PX / 2, width: EDGE_HIT_PX }}
                onPointerDown={(e) => onTrimStartDown(seg, e, eff)}
              />
              <div
                className="relative z-10 flex min-w-0 flex-1 cursor-grab items-center justify-center px-1 active:cursor-grabbing"
                onPointerDown={(e) => onBodyDown(seg, e)}
              >
                <span className="truncate">
                  {seg.clipSegment.role === "hook" ? "⚡" : ""}#{i + 1}
                </span>
              </div>
              <div
                className="absolute top-0 bottom-0 z-20 cursor-ew-resize"
                style={{ right: -EDGE_HIT_PX / 2, width: EDGE_HIT_PX }}
                onPointerDown={(e) => onTrimEndDown(seg, e, eff)}
              />
            </div>
          );
        })}
      </div>

      <p className="text-center text-[10px] text-zinc-600">
        {hookMarkingActive
          ? "arraste na sequência para marcar o hook · "
          : ""}
        arraste o corpo para reordenar · bordas para cortar · Ctrl+Z desfaz
        corte
      </p>
    </div>
  );
}
