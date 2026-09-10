"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatClipTime } from "../../../../../../lib/finalizationTime";
import type { CompositionSegmentView } from "./SequenceTimeline";

type Props = {
  segments: CompositionSegmentView[];
  totalDuration: number;
  segmentVideoSrc: (seg: CompositionSegmentView) => string | null;
  loopEnabled: boolean;
  onLoopEnabledChange: (enabled: boolean) => void;
  onTrimLastSegment: (trimSec: number) => Promise<void>;
  closingEnabled: boolean;
};

const LOOP_PREVIEW_SEC = 1.5;
const PANEL_WINDOW_SEC = 1;

function sampleBrightness(video: HTMLVideoElement): number | null {
  if (video.videoWidth <= 0 || video.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / (data.length / 4);
}

export function LoopPanel({
  segments,
  totalDuration,
  segmentVideoSrc,
  loopEnabled,
  onLoopEnabledChange,
  onTrimLastSegment,
  closingEnabled,
}: Props) {
  const startVideoRef = useRef<HTMLVideoElement>(null);
  const endVideoRef = useRef<HTMLVideoElement>(null);
  const loopActiveRef = useRef(false);
  const [loopPlaying, setLoopPlaying] = useState(false);
  const [trimBusy, setTrimBusy] = useState(false);
  const [startBrightness, setStartBrightness] = useState<number | null>(null);
  const [endBrightness, setEndBrightness] = useState<number | null>(null);

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const startSrc = firstSeg ? segmentVideoSrc(firstSeg) : null;
  const endSrc = lastSeg ? segmentVideoSrc(lastSeg) : null;

  const endAt = lastSeg
    ? Math.max(0, lastSeg.durationSec - PANEL_WINDOW_SEC)
    : 0;

  useEffect(() => {
    const sv = startVideoRef.current;
    const ev = endVideoRef.current;
    if (sv && startSrc) {
      sv.src = startSrc;
      sv.currentTime = 0;
    }
    if (ev && endSrc) {
      ev.src = endSrc;
      ev.currentTime = endAt;
    }
  }, [startSrc, endSrc, endAt]);

  const measureFrames = useCallback(() => {
    const sv = startVideoRef.current;
    const ev = endVideoRef.current;
    if (sv) setStartBrightness(sampleBrightness(sv));
    if (ev) setEndBrightness(sampleBrightness(ev));
  }, []);

  useEffect(() => {
    const sv = startVideoRef.current;
    const ev = endVideoRef.current;
    sv?.addEventListener("seeked", measureFrames);
    ev?.addEventListener("seeked", measureFrames);
    return () => {
      sv?.removeEventListener("seeked", measureFrames);
      ev?.removeEventListener("seeked", measureFrames);
    };
  }, [measureFrames, startSrc, endSrc]);

  const stopLoop = useCallback(() => {
    loopActiveRef.current = false;
    setLoopPlaying(false);
    startVideoRef.current?.pause();
    endVideoRef.current?.pause();
  }, []);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const waitSeek = (video: HTMLVideoElement) =>
    new Promise<void>((resolve) => {
      const fn = () => {
        video.removeEventListener("seeked", fn);
        resolve();
      };
      video.addEventListener("seeked", fn);
    });

  const waitDuration = (sec: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, sec * 1000);
    });

  const handleLoopButton = useCallback(async () => {
    if (loopPlaying) {
      stopLoop();
      return;
    }
    const ev = endVideoRef.current;
    const sv = startVideoRef.current;
    if (!ev || !sv || !lastSeg) return;

    loopActiveRef.current = true;
    setLoopPlaying(true);
    onLoopEnabledChange(true);

    while (loopActiveRef.current) {
      ev.currentTime = Math.max(0, lastSeg.durationSec - LOOP_PREVIEW_SEC);
      await waitSeek(ev);
      await ev.play();
      await waitDuration(LOOP_PREVIEW_SEC);
      ev.pause();
      if (!loopActiveRef.current) break;

      sv.currentTime = 0;
      await waitSeek(sv);
      await sv.play();
      await waitDuration(LOOP_PREVIEW_SEC);
      sv.pause();
    }
    setLoopPlaying(false);
  }, [lastSeg, loopPlaying, onLoopEnabledChange, stopLoop]);

  const brightnessDelta =
    startBrightness !== null && endBrightness !== null
      ? Math.abs(startBrightness - endBrightness)
      : null;

  const handleTrim = async () => {
    if (!lastSeg) return;
    setTrimBusy(true);
    try {
      await onTrimLastSegment(0.3);
    } finally {
      setTrimBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-400">loop</p>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={loopEnabled}
            onChange={(e) => onLoopEnabledChange(e.target.checked)}
          />
          avaliar loop
        </label>
      </div>

      {closingEnabled && loopEnabled && (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Fechamento anexado quebra o loop — desligue um dos dois para exportar
          com loop limpo.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-500">último {PANEL_WINDOW_SEC}s</p>
          <video
            ref={endVideoRef}
            muted
            playsInline
            className="aspect-[9/16] w-full rounded border border-zinc-700 bg-black object-cover"
            onLoadedData={measureFrames}
          />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-500">primeiro {PANEL_WINDOW_SEC}s</p>
          <video
            ref={startVideoRef}
            muted
            playsInline
            className="aspect-[9/16] w-full rounded border border-zinc-700 bg-black object-cover"
            onLoadedData={measureFrames}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleLoopButton()}
        className="w-full rounded border border-violet-600/50 bg-violet-900/30 px-3 py-2 text-xs text-violet-100 hover:bg-violet-900/50"
      >
        {loopPlaying
          ? "parar repetição"
          : `repetir ${formatClipTime(LOOP_PREVIEW_SEC)} fim + ${formatClipTime(LOOP_PREVIEW_SEC)} início`}
      </button>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={trimBusy || !lastSeg}
          onClick={() => void handleTrim()}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {trimBusy ? "…" : "aparar 0,3s do fim"}
        </button>
        <span className="self-center text-[10px] text-zinc-600">Ctrl+Z desfaz</span>
      </div>

      <div className="space-y-1 text-xs text-zinc-500">
        <p className="font-medium text-zinc-400">compatibilidade visual</p>
        {brightnessDelta !== null ? (
          <p>
            Δ brilho médio: {brightnessDelta.toFixed(0)} / 255
            {brightnessDelta < 25
              ? " · enquadramento: compare manualmente nos players"
              : " · diferença de luz perceptível"}
          </p>
        ) : (
          <p>carregando amostras…</p>
        )}
        <p className="text-[10px] text-zinc-600">
          Informação apenas — não julga se o loop funciona.
        </p>
      </div>

      <p className="text-[10px] text-zinc-600">
        Duração conteúdo {formatClipTime(totalDuration)} · loop não altera export.
      </p>
    </div>
  );
}
