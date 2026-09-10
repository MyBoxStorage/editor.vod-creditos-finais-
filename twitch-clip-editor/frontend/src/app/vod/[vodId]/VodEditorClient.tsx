"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createClipSegment,
  fetchAllCandidates,
  fetchChapters,
  fetchClipSegments,
  fetchNavThumbnails,
  fetchWaveform,
  mediaUrl,
  type AcousticCandidate,
  type ClipSegment,
  type NavThumbnailManifest,
  type ObsChapter,
  type SemanticCandidate,
  type WaveformResponse,
} from "../../../lib/api";
import {
  isSegmentDurationBlocked,
  SEGMENT_DURATION_BLOCK_MESSAGE,
  segmentDurationSec,
} from "../../../lib/segmentDurationPolicy";
import {
  chapterSelectionWindow,
  clampTimeToVod,
  computeNavigationViewport,
  dragTimeFromAnchor,
  pctInWindow,
  xToTime,
  ZOOM_LABELS,
  ZOOM_LEVELS,
  type DragAnchor,
  type NavigationViewport,
  type ZoomLevel,
} from "./vodNavigationViewport";

const MIN_SELECTION_SEC = 0.1;
const DEFAULT_CHAPTER_BEFORE = 40;
const DEFAULT_CHAPTER_AFTER = 20;
const FRAME_SEC = 1 / 30;

type AiMarker = {
  key: string;
  kind: "semantic" | "acoustic";
  start: number;
  end: number;
  title: string;
  wasRankedByClaude: boolean;
};

type Props = { vodId: string };

function formatVodTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).replace(".", ",");
  return `${m}:${sec.padStart(4, "0")}`;
}

function toAiFromSemantic(c: SemanticCandidate, i: number): AiMarker {
  return {
    key: `semantic-${i}-${c.start}`,
    kind: "semantic",
    start: c.start,
    end: c.end,
    title: c.title,
    wasRankedByClaude: c.wasRankedByClaude,
  };
}

function toAiFromAcoustic(c: AcousticCandidate, i: number): AiMarker {
  return {
    key: `acoustic-${i}-${c.start}`,
    kind: "acoustic",
    start: c.start,
    end: c.end,
    title: `Pico acústico (${c.source ?? "energy"})`,
    wasRankedByClaude: c.wasRankedByClaude,
  };
}

export function VodEditorClient({ vodId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("full");
  const [windowStart, setWindowStart] = useState(0);
  const [barWidthPx, setBarWidthPx] = useState(0);

  const [aiMarkers, setAiMarkers] = useState<AiMarker[]>([]);
  const [showAi, setShowAi] = useState(true);
  const [chapters, setChapters] = useState<ObsChapter[]>([]);
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [waveform, setWaveform] = useState<WaveformResponse | null>(null);
  const [thumbs, setThumbs] = useState<NavThumbnailManifest | null>(null);
  const [waveformStatus, setWaveformStatus] = useState("");
  const [thumbStatus, setThumbStatus] = useState("");

  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [editingSel, setEditingSel] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const [chapterBefore, setChapterBefore] = useState(DEFAULT_CHAPTER_BEFORE);
  const [chapterAfter, setChapterAfter] = useState(DEFAULT_CHAPTER_AFTER);

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverThumb, setHoverThumb] = useState<string | null>(null);

  const panAnchorRef = useRef<{ pointerX: number; windowStart: number } | null>(
    null
  );
  const handleDragRef = useRef<{
    which: "start" | "end" | "pan";
    anchor: DragAnchor;
    base: { start: number; end: number };
  } | null>(null);

  const videoSrc = useMemo(
    () => (vodId ? mediaUrl(vodId, "source.mp4") : ""),
    [vodId]
  );

  const viewport: NavigationViewport | null = useMemo(() => {
    if (!(duration > 0) || !(barWidthPx > 0)) return null;
    return computeNavigationViewport(
      duration,
      zoomLevel,
      barWidthPx,
      windowStart
    );
  }, [duration, zoomLevel, barWidthPx, windowStart]);

  const displaySel = editingSel ?? {
    start: selStart ?? 0,
    end: selEnd ?? 0,
  };
  const hasSelection =
    selStart != null && selEnd != null && selEnd > selStart + MIN_SELECTION_SEC;

  const sortedAi = useMemo(
    () => [...aiMarkers].sort((a, b) => a.start - b.start),
    [aiMarkers]
  );

  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const measure = () => setBarWidthPx(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!vodId) return;
    let cancelled = false;
    (async () => {
      try {
        const [all, segs, ch] = await Promise.all([
          fetchAllCandidates(vodId),
          fetchClipSegments(vodId),
          fetchChapters(vodId),
        ]);
        if (cancelled) return;
        setAiMarkers([
          ...all.acousticCandidates.map(toAiFromAcoustic),
          ...all.semanticCandidates.map(toAiFromSemantic),
        ]);
        setSegments(segs.clipSegments ?? []);
        setChapters(ch);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  useEffect(() => {
    if (!vodId) return;
    let cancelled = false;
    (async () => {
      setWaveformStatus("Gerando forma de onda…");
      try {
        const wf = await fetchWaveform(vodId);
        if (!cancelled) {
          setWaveform(wf);
          setWaveformStatus(
            wf.cached
              ? "Forma de onda em cache"
              : `Forma de onda gerada em ${(wf.elapsedMs / 1000).toFixed(1)}s`
          );
        }
      } catch (e) {
        if (!cancelled) {
          setWaveformStatus("");
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  useEffect(() => {
    if (!vodId) return;
    let cancelled = false;
    (async () => {
      setThumbStatus("Gerando miniaturas…");
      try {
        const strip = await fetchNavThumbnails(vodId);
        if (!cancelled) {
          setThumbs(strip);
          setThumbStatus(
            strip.cached
              ? "Miniaturas em cache"
              : `Miniaturas geradas em ${(strip.elapsedMs / 1000).toFixed(1)}s`
          );
        }
      } catch (e) {
        if (!cancelled) setThumbStatus("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setPlayhead(video.currentTime);
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, []);

  const seekTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(duration || video.duration, t));
    video.currentTime = clamped;
    setPlayhead(clamped);
  }, [duration]);

  const applySelection = useCallback((start: number, end: number) => {
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (hi - lo < MIN_SELECTION_SEC) return;
    setSelStart(lo);
    setSelEnd(hi);
    setEditingSel(null);
  }, []);

  const markIn = useCallback(() => {
    setSelStart(playhead);
    if (selEnd != null && selEnd <= playhead) setSelEnd(null);
  }, [playhead, selEnd]);

  const markOut = useCallback(() => {
    if (selStart == null) {
      setSelStart(playhead);
      setSelEnd(playhead + MIN_SELECTION_SEC);
      return;
    }
    applySelection(selStart, playhead);
  }, [playhead, selStart, applySelection]);

  const jumpAi = useCallback(
    (dir: 1 | -1) => {
      if (sortedAi.length === 0) return;
      const idx =
        dir === 1
          ? sortedAi.findIndex((m) => m.start > playhead + 0.05)
          : [...sortedAi].reverse().findIndex((m) => m.start < playhead - 0.05);
      if (idx < 0) return;
      const target =
        dir === 1 ? sortedAi[idx] : sortedAi[sortedAi.length - 1 - idx];
      applySelection(target.start, target.end);
      seekTo(target.start);
    },
    [sortedAi, playhead, applySelection, seekTo]
  );

  const jumpChapter = useCallback(
    (dir: 1 | -1) => {
      if (chapters.length === 0) return;
      const sorted = [...chapters].sort((a, b) => a.timeSec - b.timeSec);
      const idx =
        dir === 1
          ? sorted.findIndex((c) => c.timeSec > playhead + 0.05)
          : [...sorted].reverse().findIndex((c) => c.timeSec < playhead - 0.05);
      if (idx < 0) return;
      const ch = dir === 1 ? sorted[idx] : sorted[sorted.length - 1 - idx];
      const w = chapterSelectionWindow(
        ch.timeSec,
        chapterBefore,
        chapterAfter,
        duration
      );
      applySelection(w.startSec, w.endSec);
      seekTo(w.startSec);
    },
    [chapters, playhead, chapterBefore, chapterAfter, duration, applySelection, seekTo]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
        return;
      }
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        markIn();
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        markOut();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const sign = e.key === "ArrowLeft" ? -1 : 1;
        let delta = 1;
        if (e.shiftKey) delta = 10;
        if (e.ctrlKey) delta = FRAME_SEC;
        seekTo(playhead + sign * delta);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        jumpAi(e.key === "]" ? 1 : -1);
        return;
      }
      if (e.key === "{" || e.key === "}") {
        e.preventDefault();
        jumpChapter(e.key === "}" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead, seekTo, markIn, markOut, jumpAi, jumpChapter]);

  async function onCreateTrecho() {
    if (!hasSelection || selStart == null || selEnd == null) return;
    if (isSegmentDurationBlocked(selStart, selEnd)) {
      setError(
        SEGMENT_DURATION_BLOCK_MESSAGE(segmentDurationSec(selStart, selEnd))
      );
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Criando trecho…");
    try {
      const result = await createClipSegment(vodId, {
        start: selStart,
        end: selEnd,
      });
      setSegments((prev) => [...prev, result.clipSegment]);
      setStatus(
        `Trecho criado (${formatVodTime(selStart)}–${formatVodTime(selEnd)}). Abra na gaveta de edição.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function onTimelinePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!viewport || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = clampTimeToVod(xToTime(x, viewport), duration);
    const handleEl = (e.target as HTMLElement).closest(
      "[data-handle]"
    ) as HTMLElement | null;

    if (handleEl?.dataset.handle) {
      const which = handleEl.dataset.handle as "start" | "end";
      if (!hasSelection) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      handleDragRef.current = {
        which,
        anchor: { pointerX: e.clientX, timeSec: which === "start" ? displaySel.start : displaySel.end, pxPerSec: viewport.pxPerSec },
        base: { start: displaySel.start, end: displaySel.end },
      };
      return;
    }

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panAnchorRef.current = { pointerX: e.clientX, windowStart: viewport.windowStartSec };
    handleDragRef.current = {
      which: "pan",
      anchor: { pointerX: e.clientX, timeSec: t, pxPerSec: viewport.pxPerSec },
      base: { start: 0, end: 0 },
    };
    seekTo(t);
  }

  function onTimelinePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!viewport || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const hoverT = clampTimeToVod(xToTime(x, viewport), duration);
    setHoverTime(hoverT);

    if (thumbs) {
      const idx = Math.max(
        0,
        Math.min(
          thumbs.thumbnails.length - 1,
          Math.round(hoverT / thumbs.intervalSec)
        )
      );
      const entry = thumbs.thumbnails[idx];
      setHoverThumb(entry ? mediaUrl(vodId, entry.relativePath) : null);
    }

    const session = handleDragRef.current;
    if (!session) return;

    if (session.which === "pan") {
      const pan = panAnchorRef.current;
      if (!pan) return;
      const deltaPx = e.clientX - pan.pointerX;
      const deltaSec = deltaPx / session.anchor.pxPerSec;
      const maxStart = Math.max(0, duration - viewport.windowSpanSec);
      setWindowStart(
        Math.max(0, Math.min(maxStart, pan.windowStart + deltaSec))
      );
      return;
    }

    let t = dragTimeFromAnchor(session.anchor, e.clientX, e.shiftKey);
    t = clampTimeToVod(t, duration);
    if (session.which === "start") {
      const start = Math.min(t, session.base.end - MIN_SELECTION_SEC);
      setEditingSel({ start, end: session.base.end });
    } else {
      const end = Math.max(t, session.base.start + MIN_SELECTION_SEC);
      setEditingSel({ start: session.base.start, end });
    }
  }

  function onTimelinePointerUp() {
    const session = handleDragRef.current;
    if (!session) return;
    if (session.which !== "pan" && editingSel) {
      applySelection(editingSel.start, editingSel.end);
    }
    handleDragRef.current = null;
    panAnchorRef.current = null;
  }

  function onZoomChange(level: ZoomLevel) {
    setZoomLevel(level);
    if (viewport) {
      const center = viewport.windowStartSec + viewport.windowSpanSec / 2;
      const span = level === "full" ? duration : Math.min(
        level === "10m" ? 600 : level === "1m" ? 60 : 10,
        duration
      );
      setWindowStart(Math.max(0, Math.min(duration - span, center - span / 2)));
    }
  }

  const waveformCanvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !waveform || !viewport || !(barWidthPx > 0)) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = barWidthPx * dpr;
      canvas.height = 48 * dpr;
      canvas.style.width = `${barWidthPx}px`;
      canvas.style.height = "48px";
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, barWidthPx, 48);
      const { peaks, durationSec } = waveform;
      const startBucket = Math.floor(
        (viewport.windowStartSec / durationSec) * peaks.length
      );
      const endBucket = Math.ceil(
        ((viewport.windowStartSec + viewport.windowSpanSec) / durationSec) *
          peaks.length
      );
      const visible = peaks.slice(startBucket, endBucket);
      const step = barWidthPx / Math.max(visible.length, 1);
      ctx.fillStyle = "#38bdf8";
      for (let i = 0; i < visible.length; i++) {
        const h = visible[i] * 44;
        const x = i * step;
        ctx.fillRect(x, 48 - h, Math.max(step, 1), h);
      }
    },
    [waveform, viewport, barWidthPx]
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-[100vw] space-y-3 p-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">VOD completo — {vodId}</h1>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/vod/${vodId}/segments`} className="text-sky-400 hover:text-sky-300">
              Gaveta de edição
            </Link>
            <Link href={`/vod/${vodId}/marked`} className="text-zinc-400 hover:text-zinc-200">
              Candidatos marcados
            </Link>
            <Link href={`/vod/${vodId}/prontos`} className="text-zinc-600 hover:text-zinc-400 text-xs">
              arquivos prontos
            </Link>
            <Link href="/" className="text-zinc-400 hover:text-zinc-200">
              ← Início
            </Link>
          </div>
        </header>

        {error && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        {status && (
          <p className="rounded border border-emerald-800/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
            {status}
          </p>
        )}

        <video
          ref={videoRef}
          src={videoSrc}
          controls
          className="w-full max-h-[50vh] rounded bg-black"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-400">
            tempo do VOD: <strong className="text-zinc-100">{formatVodTime(playhead)}</strong>
            {" / "}
            {formatVodTime(duration)}
          </span>
          <div className="flex flex-wrap gap-1">
            {ZOOM_LEVELS.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => onZoomChange(z)}
                className={`rounded px-2 py-1 text-xs ${
                  zoomLevel === z
                    ? "bg-sky-700 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {ZOOM_LABELS[z]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showAi}
              onChange={(e) => setShowAi(e.target.checked)}
            />
            sugestões da IA
          </label>
        </div>

        {chapters.length > 0 && (
          <div className="flex flex-wrap items-end gap-4 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
            <span className="text-zinc-400">janela do marcador OBS (segundos):</span>
            <label>
              antes
              <input
                type="number"
                min={0}
                step={1}
                value={chapterBefore}
                onChange={(e) => setChapterBefore(Number(e.target.value) || 0)}
                className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5"
              />
            </label>
            <label>
              depois
              <input
                type="number"
                min={0}
                step={1}
                value={chapterAfter}
                onChange={(e) => setChapterAfter(Number(e.target.value) || 0)}
                className="ml-1 w-16 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5"
              />
            </label>
            <span className="text-zinc-500">
              total {chapterBefore + chapterAfter}s ao clicar num marcador
            </span>
          </div>
        )}

        <div className="relative">
          {hoverThumb && hoverTime != null && (
            <div
              className="pointer-events-none absolute z-30 -translate-x-1/2 rounded border border-zinc-600 bg-zinc-900 p-1 shadow-lg"
              style={{
                left: viewport
                  ? `${pctInWindow(hoverTime, viewport)}%`
                  : "50%",
                top: -120,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={hoverThumb} alt="" className="h-16 w-auto rounded" />
              <p className="mt-1 text-center text-[10px] text-zinc-400">
                {formatVodTime(hoverTime)}
              </p>
            </div>
          )}

          <div
            ref={timelineRef}
            className="relative h-28 cursor-crosshair touch-none rounded border border-zinc-800 bg-zinc-900"
            onPointerDown={onTimelinePointerDown}
            onPointerMove={onTimelinePointerMove}
            onPointerUp={onTimelinePointerUp}
            onPointerCancel={onTimelinePointerUp}
            onPointerLeave={() => {
              setHoverTime(null);
              setHoverThumb(null);
            }}
          >
            {viewport && thumbs && (
              <div className="absolute inset-x-0 top-0 flex h-10 overflow-hidden opacity-80">
                {thumbs.thumbnails.map((t) => {
                  const left = pctInWindow(t.timeSec, viewport);
                  if (left < -5 || left > 105) return null;
                  return (
                    <div
                      key={t.index}
                      className="absolute top-0 h-10 w-8 bg-cover bg-center"
                      style={{
                        left: `${left}%`,
                        backgroundImage: `url(${mediaUrl(vodId, t.relativePath)})`,
                      }}
                    />
                  );
                })}
              </div>
            )}

            <canvas
              ref={waveformCanvasRef}
              className="absolute bottom-0 left-0 h-12 w-full"
            />

            {viewport &&
              segments.map((s) => {
                const left = pctInWindow(s.sourceStart, viewport);
                const right = pctInWindow(s.sourceEnd, viewport);
                const w = Math.max(right - left, 0.3);
                if (right < 0 || left > 100) return null;
                return (
                  <div
                    key={s.id}
                    className="pointer-events-none absolute bottom-12 top-10 rounded border border-violet-400/60 bg-violet-500/25"
                    style={{ left: `${left}%`, width: `${w}%` }}
                    title={`Trecho ${formatVodTime(s.sourceStart)}–${formatVodTime(s.sourceEnd)}`}
                  />
                );
              })}

            {viewport &&
              showAi &&
              aiMarkers.map((m) => {
                const left = pctInWindow(m.start, viewport);
                const right = pctInWindow(m.end, viewport);
                const w = Math.max(right - left, 0.3);
                if (right < 0 || left > 100) return null;
                const color = m.wasRankedByClaude
                  ? "bg-emerald-500/70"
                  : m.kind === "semantic"
                    ? "bg-sky-500/60"
                    : "bg-amber-500/60";
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`absolute bottom-12 top-10 rounded ${color} hover:ring-1 hover:ring-white/50`}
                    style={{ left: `${left}%`, width: `${w}%` }}
                    title={m.title}
                    onClick={(e) => {
                      e.stopPropagation();
                      applySelection(m.start, m.end);
                      seekTo(m.start);
                    }}
                  />
                );
              })}

            {viewport &&
              chapters.map((ch, i) => {
                const left = pctInWindow(ch.timeSec, viewport);
                if (left < 0 || left > 100) return null;
                return (
                  <button
                    key={`ch-${i}-${ch.timeSec}`}
                    type="button"
                    className="absolute bottom-0 top-0 z-10 w-0.5 -translate-x-1/2 bg-fuchsia-400 hover:w-1"
                    style={{ left: `${left}%` }}
                    title={ch.title || `marcador ${formatVodTime(ch.timeSec)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const w = chapterSelectionWindow(
                        ch.timeSec,
                        chapterBefore,
                        chapterAfter,
                        duration
                      );
                      applySelection(w.startSec, w.endSec);
                      seekTo(w.startSec);
                    }}
                  />
                );
              })}

            {viewport && hasSelection && (
              <>
                <div
                  className="pointer-events-none absolute bottom-0 top-0 bg-sky-500/30 border-x border-sky-400"
                  style={{
                    left: `${pctInWindow(displaySel.start, viewport)}%`,
                    width: `${Math.max(
                      pctInWindow(displaySel.end, viewport) -
                        pctInWindow(displaySel.start, viewport),
                      0.2
                    )}%`,
                  }}
                />
                <button
                  type="button"
                  data-handle="start"
                  className="absolute bottom-0 top-0 z-20 w-2 -translate-x-1/2 cursor-ew-resize bg-white"
                  style={{ left: `${pctInWindow(displaySel.start, viewport)}%` }}
                />
                <button
                  type="button"
                  data-handle="end"
                  className="absolute bottom-0 top-0 z-20 w-2 -translate-x-1/2 cursor-ew-resize bg-white"
                  style={{ left: `${pctInWindow(displaySel.end, viewport)}%` }}
                />
              </>
            )}

            {viewport && (
              <div
                className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 -translate-x-1/2 bg-red-400"
                style={{ left: `${pctInWindow(playhead, viewport)}%` }}
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          <span>
            <span className="inline-block h-2 w-3 rounded bg-emerald-500 mr-1" />
            sugestão Claude
          </span>
          <span>
            <span className="inline-block h-2 w-3 rounded bg-sky-500 mr-1" />
            semântico
          </span>
          <span>
            <span className="inline-block h-2 w-3 rounded bg-amber-500 mr-1" />
            acústico
          </span>
          <span>
            <span className="inline-block h-2 w-3 rounded bg-fuchsia-400 mr-1" />
            marcador OBS
          </span>
          <span>
            <span className="inline-block h-2 w-3 rounded bg-violet-500 mr-1" />
            trecho criado
          </span>
          <span>{waveformStatus}</span>
          <span>{thumbStatus}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {hasSelection && selStart != null && selEnd != null && (
            <p className="text-sm text-zinc-300">
              seleção: {formatVodTime(selStart)}–{formatVodTime(selEnd)} (
              {formatVodTime(selEnd - selStart)})
            </p>
          )}
          <button
            type="button"
            disabled={!hasSelection || busy}
            onClick={() => void onCreateTrecho()}
            className="rounded bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-600 disabled:opacity-50"
          >
            criar trecho na gaveta
          </button>
          {hasSelection && (
            <button
              type="button"
              className="rounded bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
              onClick={() => {
                setSelStart(null);
                setSelEnd(null);
                setEditingSel(null);
              }}
            >
              limpar seleção
            </button>
          )}
        </div>

        <p className="text-xs text-zinc-600">
          Atalhos: I/O marcar início/fim · espaço reproduzir · setas ±1s · shift+setas ±10s ·
          ctrl+setas 1 quadro · [ ] sugestão anterior/próxima · {"{ }"} marcador OBS
          anterior/próximo
        </p>
      </div>
    </div>
  );
}
