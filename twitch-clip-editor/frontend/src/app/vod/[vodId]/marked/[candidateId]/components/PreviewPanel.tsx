"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipEffectInstance } from "../../../../../../lib/api";
import { mediaUrl, libraryMediaUrl } from "../../../../../../lib/api";
import type { EditKind } from "../types";
import { formatTime } from "../utils";
import {
  activeVideoOverlays,
  colorFilterStyle,
  playbackRateAt,
  zoomTransformStyle,
  type FastPreviewState,
} from "../fastPreview";
import { ffmpegLinearFadeOpacity } from "../../../../../../lib/overlayFade";
import type { FaithfulPreviewState } from "../editorRenderDispatch";
import { AnimatedSubtitleOverlay } from "./AnimatedSubtitleOverlay";
import type { SubtitleSettings } from "../../../../../../lib/animatedSubtitle";
import { useOverlayEdit } from "../overlayEditContext";
import { OverlayTransformEditor } from "./OverlayTransformEditor";

type PreviewPanelProps = {
  vodId: string;
  editKind: EditKind;
  videoSrc: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  faithfulVideoRef: RefObject<HTMLVideoElement | null>;
  start: number;
  clipOriginRef: RefObject<number>;
  clipDuration: number;
  onDurationLoaded: (duration: number) => void;
  onPlayheadUpdate?: (clipRelativeTime: number) => void;
  onSeek?: (clipRelativeTime: number) => void;
  fastPreview: FastPreviewState;
  faithfulPreview: FaithfulPreviewState;
  subtitleSettings?: SubtitleSettings;
  previewPreparing?: boolean;
  onRequestFaithfulRender: () => void;
  playheadTime: number;
  jklPlaybackRef?: RefObject<{ active: boolean; rate: number }>;
};

function SafeZonesOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  const coverFill = "rgba(220, 38, 38, 0.12)";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div
        className="absolute left-0 right-0 border-b border-dashed border-red-400/50"
        style={{
          top: 0,
          height: "14%",
          background: coverFill,
        }}
      />
      <div
        className="absolute left-0 right-0 border-t border-dashed border-red-400/50"
        style={{
          top: "76%",
          height: "24%",
          background: coverFill,
        }}
      />
      <div
        className="absolute border border-dashed border-emerald-400/70"
        style={{
          left: "20%",
          right: "20%",
          top: "14%",
          bottom: "24%",
        }}
      />
    </div>
  );
}

function FastPreviewAudioSync({
  vodId,
  videoRef,
  effects,
  clipRelativeTime,
}: {
  vodId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  effects: ClipEffectInstance[];
  clipRelativeTime: (videoTime: number) => number;
}) {
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const activeKeys = useRef<Set<string>>(new Set());

  const syncAudioToVideo = useCallback(
    (video: HTMLVideoElement) => {
      const t = clipRelativeTime(video.currentTime);
      for (const inst of effects) {
        const type = inst.type ?? inst.libraryItem?.type;
        if (type !== "music" && type !== "sfx") continue;
        const filePath = inst.libraryItem?.filePath;
        if (!filePath) continue;
        const clipTs = inst.clipTimestamp ?? 0;
        const partStart = inst.sourceTrimStart ?? 0;
        const partEnd = inst.sourceTrimEnd ?? partStart + 1;
        const partDur = Math.max(0.05, partEnd - partStart);
        const key = inst.id;
        const inWindow = t >= clipTs && t < clipTs + partDur;

        if (!inWindow) {
          if (activeKeys.current.has(key)) {
            const el = audioRefs.current.get(key);
            el?.pause();
            activeKeys.current.delete(key);
          }
          continue;
        }

        let el = audioRefs.current.get(key);
        if (!el) {
          el = new Audio(mediaUrl(vodId, filePath));
          el.preload = "auto";
          audioRefs.current.set(key, el);
        }
        const vol = inst.volume ?? (type === "music" ? 0.2 : 0.85);
        el.volume = Math.max(0, Math.min(1, vol));
        const offset = Math.max(0, t - clipTs);
        const targetTime = partStart + offset;
        if (Math.abs(el.currentTime - targetTime) > 0.25) {
          el.currentTime = targetTime;
        }
        if (video.paused) {
          el.pause();
        } else if (el.paused) {
          void el.play().catch(() => {});
        }
        activeKeys.current.add(key);
      }
    },
    [clipRelativeTime, effects, vodId]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => syncAudioToVideo(video);
    const onPlay = () => syncAudioToVideo(video);
    const onPause = () => {
      audioRefs.current.forEach((a) => a.pause());
      activeKeys.current.clear();
    };
    const onSeeked = () => {
      audioRefs.current.forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
      activeKeys.current.clear();
      syncAudioToVideo(video);
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [syncAudioToVideo, videoRef]);

  return null;
}

export function PreviewPanel({
  vodId,
  editKind,
  videoSrc,
  videoRef,
  faithfulVideoRef,
  start,
  clipOriginRef,
  clipDuration,
  onDurationLoaded,
  onPlayheadUpdate,
  onSeek,
  fastPreview,
  faithfulPreview,
  subtitleSettings,
  previewPreparing = false,
  onRequestFaithfulRender,
  playheadTime,
  jklPlaybackRef,
}: PreviewPanelProps) {
  const { draft, setDraft } = useOverlayEdit();
  const [safeZonesVisible, setSafeZonesVisible] = useState(true);
  const [clipTime, setClipTime] = useState(0);
  const prevFaithfulMode = useRef(false);

  const showFaithful =
    faithfulPreview.mode === "faithful" && faithfulPreview.url != null;

  const clipRelativeTime = useCallback(
    (videoTime: number): number => {
      if (editKind === "clip_segment") {
        return Math.max(0, Math.min(clipDuration, videoTime));
      }
      return Math.max(0, Math.min(clipDuration, videoTime - start));
    },
    [clipDuration, editKind, start]
  );

  const displayTime = showFaithful
    ? Math.max(
        0,
        Math.min(
          faithfulPreview.windowEnd - faithfulPreview.windowStart,
          playheadTime - faithfulPreview.windowStart
        )
      )
    : playheadTime;

  const zoomStyle = zoomTransformStyle(fastPreview.zoomKeyframes, displayTime);
  const filterStyle = colorFilterStyle(
    fastPreview.colorPreset,
    fastPreview.colorIntensityPercent,
    displayTime,
    fastPreview.colorEffectStart,
    fastPreview.colorEffectEnd
  );

  const videoOverlays = activeVideoOverlays(
    fastPreview.appliedEffects,
    displayTime
  );

  const draftLocalT = draft.active ? displayTime - draft.clipTimestamp : -1;
  const draftInWindow =
    draft.active &&
    draftLocalT >= 0 &&
    draftLocalT <= draft.overlayDuration + 0.001;
  const draftFadeOpacity = draftInWindow
    ? ffmpegLinearFadeOpacity(
        draftLocalT,
        draft.overlayDuration,
        draft.fadeInSeconds,
        draft.fadeOutSeconds
      )
    : 0.85;

  const activeVideo = useCallback((): HTMLVideoElement | null => {
    if (showFaithful) return faithfulVideoRef.current;
    return videoRef.current;
  }, [showFaithful, faithfulVideoRef, videoRef]);

  const seekActiveVideo = useCallback(
    (clipT: number) => {
      const clamped = Number(
        Math.max(0, Math.min(clipDuration, clipT)).toFixed(3)
      );
      onSeek?.(clamped);
      const video = activeVideo();
      if (!video) return;
      if (showFaithful) {
        const local = Math.max(
          0,
          Math.min(
            faithfulPreview.windowEnd - faithfulPreview.windowStart,
            clamped - faithfulPreview.windowStart
          )
        );
        video.currentTime = local;
      } else if (editKind === "clip_segment") {
        video.currentTime = clamped;
      } else {
        video.currentTime = start + clamped;
      }
    },
    [
      activeVideo,
      clipDuration,
      editKind,
      faithfulPreview.windowEnd,
      faithfulPreview.windowStart,
      onSeek,
      showFaithful,
      start,
    ]
  );

  useEffect(() => {
    if (showFaithful && !prevFaithfulMode.current) {
      const video = faithfulVideoRef.current;
      if (video) {
        const local = Math.max(
          0,
          playheadTime - faithfulPreview.windowStart
        );
        video.currentTime = local;
      }
    }
    if (!showFaithful && prevFaithfulMode.current) {
      const video = videoRef.current;
      if (video) {
        if (editKind === "clip_segment") {
          video.currentTime = playheadTime;
        } else {
          video.currentTime = start + playheadTime;
        }
      }
    }
    prevFaithfulMode.current = showFaithful;
  }, [
    showFaithful,
    faithfulVideoRef,
    videoRef,
    playheadTime,
    faithfulPreview.windowStart,
    editKind,
    start,
  ]);

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
    playheadTime,
    showFaithful,
    faithfulPreview.windowStart,
    faithfulPreview.windowEnd,
    faithfulVideoRef,
  ]);

  if (!vodId || !editKind || !videoSrc) return null;

  const windowSpan = faithfulPreview.windowEnd - faithfulPreview.windowStart;
  const windowNarrower =
    showFaithful && windowSpan + 0.05 < clipDuration;

  const badgeLabel = showFaithful
    ? [
        `render fiel · ${formatTime(faithfulPreview.windowStart)}–${formatTime(faithfulPreview.windowEnd)}`,
        faithfulPreview.excludedHook ? "não inclui hook" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "prévia rápida";

  return (
    <div className="w-[200px] shrink-0 space-y-3">
      <div className="relative mx-auto w-[200px]">
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded bg-black">
          {showFaithful ? (
            <video
              key={faithfulPreview.url ?? "faithful"}
              ref={faithfulVideoRef}
              src={faithfulPreview.url ?? undefined}
              controls
              className="h-full w-full object-contain"
              onLoadedMetadata={(e) => {
                const local = Math.max(
                  0,
                  playheadTime - faithfulPreview.windowStart
                );
                e.currentTarget.currentTime = local;
              }}
              onSeeked={(e) => {
                const local = e.currentTarget.currentTime;
                onPlayheadUpdate?.(
                  faithfulPreview.windowStart + local
                );
              }}
              onPause={(e) => {
                onPlayheadUpdate?.(
                  faithfulPreview.windowStart + e.currentTarget.currentTime
                );
              }}
              onTimeUpdate={(e) => {
                const local = e.currentTarget.currentTime;
                onPlayheadUpdate?.(
                  faithfulPreview.windowStart + local
                );
              }}
            />
          ) : (
            <>
              <div
                className="h-full w-full"
                style={{
                  filter: filterStyle === "none" ? undefined : filterStyle,
                }}
              >
                <video
                  key={videoSrc}
                  ref={videoRef}
                  src={videoSrc}
                  className="h-full w-full object-contain"
                  style={zoomStyle}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration || 0;
                    onDurationLoaded(d);
                    if (editKind === "clip_segment") {
                      e.currentTarget.currentTime = Math.max(
                        0,
                        start - clipOriginRef.current
                      );
                    } else {
                      e.currentTarget.currentTime = start;
                    }
                    const rate = playbackRateAt(
                      clipRelativeTime(e.currentTarget.currentTime),
                      fastPreview.speed,
                      fastPreview.speedRamp
                    );
                    e.currentTarget.playbackRate = rate;
                  }}
                  onSeeked={(e) => {
                    const rel = clipRelativeTime(e.currentTarget.currentTime);
                    onPlayheadUpdate?.(rel);
                  }}
                  onPause={(e) => {
                    const rel = clipRelativeTime(e.currentTarget.currentTime);
                    onPlayheadUpdate?.(rel);
                  }}
                  onTimeUpdate={(e) => {
                    const rel = clipRelativeTime(e.currentTarget.currentTime);
                    setClipTime(rel);
                    if (jklPlaybackRef?.current.active) {
                      const jklRate = jklPlaybackRef.current.rate;
                      if (
                        Math.abs(e.currentTarget.playbackRate - jklRate) > 0.01
                      ) {
                        e.currentTarget.playbackRate = jklRate;
                      }
                    } else {
                      const rate = playbackRateAt(
                        rel,
                        fastPreview.speed,
                        fastPreview.speedRamp
                      );
                      if (
                        Math.abs(e.currentTarget.playbackRate - rate) > 0.01
                      ) {
                        e.currentTarget.playbackRate = rate;
                      }
                    }
                    onPlayheadUpdate?.(rel);
                  }}
                />
              </div>
              {videoOverlays.map((ov) => (
                <div
                  key={ov.id}
                  className="pointer-events-none absolute overflow-hidden rounded border border-white/30"
                  style={{
                    left: `${ov.left}%`,
                    top: `${ov.top}%`,
                    width: `${ov.width}%`,
                    height: `${ov.height}%`,
                    opacity: ov.opacity,
                  }}
                >
                  {ov.kind === "image" ? (
                    <img
                      src={libraryMediaUrl(ov.src)}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <>
                      <video
                        src={libraryMediaUrl(ov.src)}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-0.5 text-[7px] leading-tight text-amber-200">
                        sem chroma — veja no render fiel
                      </span>
                    </>
                  )}
                </div>
              ))}
              {!showFaithful && draft.active && (
                <OverlayTransformEditor
                  positionX={draft.positionX}
                  positionY={draft.positionY}
                  positionWidth={draft.positionWidth}
                  positionHeight={draft.positionHeight}
                  aspectLocked={draft.aspectLocked}
                  imageNativeWidth={
                    draft.mediaType === "image" ? draft.imageNativeWidth : null
                  }
                  onChange={(patch) => setDraft(patch)}
                  onAspectLockedChange={(locked) =>
                    setDraft({ aspectLocked: locked })
                  }
                >
                  <div
                    className="pointer-events-none h-full w-full"
                    style={{ opacity: draftFadeOpacity }}
                  >
                    {draft.mediaType === "image" ? (
                      <img
                        src={libraryMediaUrl(draft.src)}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <video
                        src={libraryMediaUrl(draft.src)}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    )}
                  </div>
                </OverlayTransformEditor>
              )}
              {fastPreview.useSubtitles && !showFaithful && (
                <AnimatedSubtitleOverlay
                  transcript={fastPreview.transcript}
                  clipRelativeTime={displayTime}
                  settings={subtitleSettings}
                />
              )}
              <FastPreviewAudioSync
                vodId={vodId}
                videoRef={videoRef}
                effects={fastPreview.appliedEffects}
                clipRelativeTime={clipRelativeTime}
              />
            </>
          )}
          <SafeZonesOverlay visible={safeZonesVisible} />
          <label className="absolute left-1.5 top-8 z-30 flex cursor-pointer items-center gap-1.5 rounded border border-amber-500/70 bg-black/80 px-2 py-1 text-[11px] font-medium text-amber-100 shadow-md backdrop-blur-sm">
            <input
              type="checkbox"
              checked={safeZonesVisible}
              onChange={(e) => setSafeZonesVisible(e.target.checked)}
              className="accent-amber-400"
            />
            zonas seguras
          </label>
          <span className="absolute right-1.5 top-1.5 max-w-[90%] truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
            {badgeLabel}
          </span>
          {faithfulPreview.loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-zinc-200">
              renderizando…
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>{formatTime(playheadTime)}</span>
          <span>{formatTime(clipDuration)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={clipDuration || 0.1}
          step={0.01}
          value={Math.min(playheadTime, clipDuration)}
          onChange={(e) => seekActiveVideo(Number(e.target.value))}
          className="w-full accent-sky-500"
          aria-label="posição no trecho"
        />
        {windowNarrower && (
          <p className="text-center text-[10px] text-sky-300/90">
            janela renderizada: {formatTime(faithfulPreview.windowStart)}–
            {formatTime(faithfulPreview.windowEnd)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            const video = activeVideo();
            if (!video) return;
            if (video.paused) {
              void video.play();
            } else {
              video.pause();
            }
          }}
          className="w-full rounded bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
        >
          reproduzir · {formatTime(clipDuration)}
        </button>
        <button
          type="button"
          disabled={faithfulPreview.loading || previewPreparing}
          onClick={onRequestFaithfulRender}
          className="w-full rounded border border-sky-700 bg-sky-950/50 px-3 py-2 text-sm text-sky-100 hover:border-sky-500 disabled:opacity-50"
        >
          {previewPreparing
            ? "preparando trecho…"
            : faithfulPreview.loading
              ? "render fiel…"
              : faithfulPreview.cached && showFaithful
                ? "render fiel (cache)"
                : "render fiel"}
        </button>
        {showFaithful && faithfulPreview.cached && (
          <p className="text-center text-[10px] text-zinc-500">servido do cache</p>
        )}
      </div>

      <p className="text-center text-[10px] text-zinc-500">
        Use o interruptor sobre o vídeo para ligar ou desligar as zonas seguras.
      </p>
    </div>
  );
}
