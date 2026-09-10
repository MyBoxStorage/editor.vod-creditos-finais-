"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { apiUrl } from "../../../../../../lib/api";
import { formatClipTime } from "../../../../../../lib/finalizationTime";
import type { CompositionSegmentView } from "./SequenceTimeline";

export type FaithfulPreviewState = {
  mode: "fast" | "faithful";
  url: string | null;
  windowStart: number;
  windowEnd: number;
  cached: boolean;
  loading: boolean;
};

export const INITIAL_FAITHFUL_PREVIEW: FaithfulPreviewState = {
  mode: "fast",
  url: null,
  windowStart: 0,
  windowEnd: 0,
  cached: false,
  loading: false,
};

function SafeZonesOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const coverFill = "rgba(220, 38, 38, 0.12)";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute left-0 right-0 border-b border-dashed border-red-400/50"
        style={{ top: 0, height: "14%", background: coverFill }}
      />
      <div
        className="absolute left-0 right-0 border-t border-dashed border-red-400/50"
        style={{ top: "76%", height: "24%", background: coverFill }}
      />
      <div
        className="absolute border border-dashed border-emerald-400/70"
        style={{ left: "20%", right: "20%", top: "14%", bottom: "24%" }}
      />
    </div>
  );
}

type CompositionPlayerProps = {
  vodId: string;
  segments: CompositionSegmentView[];
  playheadTime: number;
  activeSegmentIndex: number;
  onPlayheadChange: (time: number) => void;
  onActiveSegmentChange: (index: number) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  faithfulVideoRef: RefObject<HTMLVideoElement | null>;
  faithfulPreview: FaithfulPreviewState;
  onRequestFaithfulRender: () => void;
  segmentVideoSrc: (seg: CompositionSegmentView) => string | null;
  showSafeZones?: boolean;
};

export function CompositionPlayer({
  vodId,
  segments,
  playheadTime,
  activeSegmentIndex,
  onPlayheadChange,
  onActiveSegmentChange,
  videoRef,
  faithfulVideoRef,
  faithfulPreview,
  onRequestFaithfulRender,
  segmentVideoSrc,
  showSafeZones = true,
}: CompositionPlayerProps) {
  const advancingRef = useRef(false);
  const showFaithful =
    faithfulPreview.mode === "faithful" && faithfulPreview.url != null;

  const activeSeg = segments[activeSegmentIndex] ?? null;
  const localTime = activeSeg
    ? Math.max(0, playheadTime - activeSeg.timelineStart)
    : 0;

  const badgeLabel = showFaithful
    ? `render fiel · ${formatClipTime(faithfulPreview.windowStart)}–${formatClipTime(faithfulPreview.windowEnd)}`
    : "prévia rápida";

  const advanceToNext = useCallback(() => {
    if (advancingRef.current) return;
    if (activeSegmentIndex >= segments.length - 1) return;
    advancingRef.current = true;
    const nextIdx = activeSegmentIndex + 1;
    const nextSeg = segments[nextIdx];
    onActiveSegmentChange(nextIdx);
    onPlayheadChange(nextSeg.timelineStart);
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      void video.play().catch(() => {});
    }
    advancingRef.current = false;
  }, [
    activeSegmentIndex,
    onActiveSegmentChange,
    onPlayheadChange,
    segments,
    videoRef,
  ]);

  useEffect(() => {
    if (showFaithful) return;
    const video = videoRef.current;
    if (!video || !activeSeg) return;

    const src = segmentVideoSrc(activeSeg);
    if (!src) return;

    const onEnded = () => advanceToNext();
    const onTimeUpdate = () => {
      const t = activeSeg.timelineStart + video.currentTime;
      onPlayheadChange(Number(t.toFixed(3)));
    };

    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [
    activeSeg,
    advanceToNext,
    onPlayheadChange,
    segmentVideoSrc,
    showFaithful,
    videoRef,
  ]);

  useEffect(() => {
    if (showFaithful || !activeSeg) return;
    const video = videoRef.current;
    if (!video) return;
    const src = segmentVideoSrc(activeSeg);
    if (src && video.src !== src) {
      video.src = src;
      video.load();
    }
    if (Math.abs(video.currentTime - localTime) > 0.35) {
      video.currentTime = localTime;
    }
  }, [activeSeg, localTime, segmentVideoSrc, showFaithful, videoRef]);

  useEffect(() => {
    if (!showFaithful) return;
    const video = faithfulVideoRef.current;
    if (!video) return;
    const local = Math.max(
      0,
      Math.min(
        faithfulPreview.windowEnd - faithfulPreview.windowStart,
        playheadTime - faithfulPreview.windowStart
      )
    );
    if (Math.abs(video.currentTime - local) > 0.35) {
      video.currentTime = local;
    }
  }, [
    faithfulPreview.windowEnd,
    faithfulPreview.windowStart,
    faithfulVideoRef,
    playheadTime,
    showFaithful,
  ]);

  const fastSrc = activeSeg ? segmentVideoSrc(activeSeg) : null;
  const faithfulSrc = faithfulPreview.url
    ? apiUrl(faithfulPreview.url)
    : null;

  return (
    <div className="w-[200px] shrink-0 space-y-3">
      <div className="relative mx-auto w-[200px]">
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded bg-black">
          {showFaithful && faithfulSrc ? (
            <video
              key={faithfulSrc}
              ref={faithfulVideoRef}
              src={faithfulSrc}
              controls
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => {
                const local = e.currentTarget.currentTime;
                onPlayheadChange(
                  Number((faithfulPreview.windowStart + local).toFixed(3))
                );
              }}
              onSeeked={(e) => {
                onPlayheadChange(
                  Number(
                    (faithfulPreview.windowStart + e.currentTarget.currentTime).toFixed(3)
                  )
                );
              }}
            />
          ) : (
            <video
              key={fastSrc ?? "fast"}
              ref={videoRef}
              src={fastSrc ?? undefined}
              controls
              className="h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                if (localTime > 0) e.currentTarget.currentTime = localTime;
              }}
            />
          )}
          {showSafeZones && <SafeZonesOverlay visible />}
        </div>

        <div
          className={`mt-2 rounded px-2 py-1 text-center text-[10px] font-medium ${
            showFaithful
              ? "border border-emerald-700/50 bg-emerald-950/50 text-emerald-200"
              : "border border-zinc-700 bg-zinc-900/80 text-zinc-400"
          }`}
        >
          {badgeLabel}
          {faithfulPreview.loading && (
            <span className="ml-1 text-zinc-500">· renderizando…</span>
          )}
        </div>
      </div>

      {!showFaithful && (
        <button
          type="button"
          onClick={onRequestFaithfulRender}
          disabled={faithfulPreview.loading || segments.length === 0}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
        >
          {faithfulPreview.loading ? "renderizando…" : "render fiel"}
        </button>
      )}

      <div className="space-y-1">
        <p className="text-[10px] text-zinc-500">trecho ativo</p>
        {segments.map((seg, i) => (
          <div
            key={seg.clipSegment.id}
            className={`rounded px-2 py-0.5 text-[10px] ${
              i === activeSegmentIndex
                ? "bg-sky-900/60 text-sky-200"
                : "text-zinc-500"
            }`}
          >
            #{i + 1}{" "}
            {seg.clipSegment.role === "hook" ? "gancho · " : ""}
            {formatClipTime(seg.durationSec)}
          </div>
        ))}
      </div>
    </div>
  );
}
