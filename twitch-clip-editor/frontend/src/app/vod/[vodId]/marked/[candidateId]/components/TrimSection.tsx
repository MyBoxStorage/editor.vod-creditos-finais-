import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PresetApplication } from "../presetApplications";
import { applicationEnd } from "../presetApplications";
import {
  pctOnBar,
  type TrimBarLayout,
  type TrimDisplayTimes,
  type VodInterval,
} from "../trimViewport";
import type { DragHandle } from "../types";
import { formatTime } from "../utils";
import {
  SEGMENT_DURATION_WARN_MESSAGE,
  shouldWarnSegmentDuration,
} from "../../../../../../lib/segmentDurationPolicy";

const EXCLUDED_STYLE: React.CSSProperties = {
  backgroundColor: "rgba(0,0,0,0.35)",
};

type TrimSectionProps = {
  material: VodInterval;
  selection: VodInterval;
  displayTimes: TrimDisplayTimes;
  trimBarLayout: TrimBarLayout | null;
  playheadAbs: number;
  trimBarRef: RefObject<HTMLDivElement | null>;
  onTrimBarWidthChange: (widthPx: number) => void;
  onTrimPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onTrimPointerUp: () => void;
  presetApplications: PresetApplication[];
  dragging: DragHandle;
  onHandlePointerDown: (
    which: "start" | "end",
    e: React.PointerEvent<HTMLButtonElement>
  ) => void;
  startInput: string;
  endInput: string;
  startTimeError: boolean;
  endTimeError: boolean;
  onStartInputChange: (value: string) => void;
  onEndInputChange: (value: string) => void;
  onStartInputBlur: () => void;
  onEndInputBlur: () => void;
  onPlayPreview: () => void;
  onNudgeStartMinus1: () => void;
  onNudgeStartMinus05: () => void;
  onNudgeStartPlus05: () => void;
  onNudgeStartPlus1: () => void;
  onNudgeEndMinus1: () => void;
  onNudgeEndMinus05: () => void;
  onNudgeEndPlus05: () => void;
  onNudgeEndPlus1: () => void;
  selectionPending: boolean;
  onConfirmCut: () => void;
  onResetSelection: () => void;
  cutBusy?: boolean;
};

export function TrimSection({
  material,
  selection,
  displayTimes,
  trimBarLayout,
  playheadAbs,
  trimBarRef,
  onTrimBarWidthChange,
  onTrimPointerMove,
  onTrimPointerUp,
  presetApplications,
  dragging,
  onHandlePointerDown,
  startInput,
  endInput,
  startTimeError,
  endTimeError,
  onStartInputChange,
  onEndInputChange,
  onStartInputBlur,
  onEndInputBlur,
  onPlayPreview,
  onNudgeStartMinus1,
  onNudgeStartMinus05,
  onNudgeStartPlus05,
  onNudgeStartPlus1,
  onNudgeEndMinus1,
  onNudgeEndMinus05,
  onNudgeEndPlus05,
  onNudgeEndPlus1,
  selectionPending,
  onConfirmCut,
  onResetSelection,
  cutBusy = false,
}: TrimSectionProps) {
  const [barWidthPx, setBarWidthPx] = useState(0);
  const barObsRef = useRef<ResizeObserver | null>(null);

  useLayoutEffect(() => {
    const el = trimBarRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setBarWidthPx(w);
      onTrimBarWidthChange(w);
    };
    measure();
    barObsRef.current?.disconnect();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    barObsRef.current = ro;
    return () => ro.disconnect();
  }, [trimBarRef, onTrimBarWidthChange]);

  const layout = trimBarLayout;
  const selLeftPct = layout ? pctOnBar(selection.startSec, layout) : 0;
  const selRightPct = layout ? pctOnBar(selection.endSec, layout) : 100;
  const selWidthPct = Math.max(selRightPct - selLeftPct, 0.5);
  const excludedLeftPct = selLeftPct;
  const excludedRightPct = 100 - selRightPct;
  const playheadPct = layout ? pctOnBar(playheadAbs, layout) : 0;

  const showDurationWarning = shouldWarnSegmentDuration(
    selection.startSec,
    selection.endSec
  );

  return (
    <div className="space-y-3">
      {showDurationWarning && (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          {SEGMENT_DURATION_WARN_MESSAGE}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-zinc-400">corte do trecho</p>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>material {formatTime(displayTimes.materialDuration)}</span>
          <span>
            seleção {formatTime(displayTimes.selectionStart)}–
            {formatTime(displayTimes.selectionEnd)} (
            {formatTime(displayTimes.selectionDuration)})
          </span>
          <span>{formatTime(displayTimes.materialDuration)}</span>
        </div>
        <div
          ref={trimBarRef}
          className="relative h-11 rounded border border-zinc-800 bg-zinc-900 touch-none"
          onPointerMove={onTrimPointerMove}
          onPointerUp={onTrimPointerUp}
          onPointerCancel={onTrimPointerUp}
        >
          {layout && layout.barEndSec > layout.barStartSec && (
            <>
              {excludedLeftPct > 0 && (
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 rounded-l"
                  style={{
                    width: `${excludedLeftPct}%`,
                    ...EXCLUDED_STYLE,
                  }}
                />
              )}
              <div
                className="pointer-events-none absolute inset-y-1 rounded bg-sky-500/70"
                style={{
                  left: `${selLeftPct}%`,
                  width: `${selWidthPct}%`,
                }}
              />
              {excludedRightPct > 0 && (
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 rounded-r"
                  style={{
                    left: `${selRightPct}%`,
                    width: `${excludedRightPct}%`,
                    ...EXCLUDED_STYLE,
                  }}
                />
              )}
              {presetApplications.map((app) => {
                const appEnd = applicationEnd(app);
                if (!(appEnd > app.inicio)) return null;
                const absEffectStart = material.startSec + app.inicio;
                const absEffectEnd = material.startSec + appEnd;
                const effectLeftPct = pctOnBar(absEffectStart, layout);
                const effectRightPct = pctOnBar(absEffectEnd, layout);
                const effectWidthPct = Math.max(
                  effectRightPct - effectLeftPct,
                  barWidthPx > 0 ? (2 / barWidthPx) * 100 : 0.5
                );
                return (
                  <div
                    key={app.id}
                    className="pointer-events-none absolute top-2 bottom-2 rounded border border-[#534AB7] bg-[#AFA9EC]/45"
                    style={{
                      left: `${effectLeftPct}%`,
                      width: `${effectWidthPct}%`,
                    }}
                    title={`${formatTime(app.inicio)}–${formatTime(appEnd)}`}
                  />
                );
              })}
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-red-400"
                style={{ left: `${playheadPct}%` }}
              />
              <button
                type="button"
                aria-label="Handle start"
                onPointerDown={(e) => onHandlePointerDown("start", e)}
                onPointerMove={onTrimPointerMove}
                onPointerUp={onTrimPointerUp}
                onPointerCancel={onTrimPointerUp}
                className={`absolute top-0 z-30 h-11 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white ${
                  dragging === "start" ? "ring-2 ring-sky-300" : ""
                }`}
                style={{ left: `${selLeftPct}%` }}
              />
              <button
                type="button"
                aria-label="Handle end"
                onPointerDown={(e) => onHandlePointerDown("end", e)}
                onPointerMove={onTrimPointerMove}
                onPointerUp={onTrimPointerUp}
                onPointerCancel={onTrimPointerUp}
                className={`absolute top-0 z-30 h-11 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white ${
                  dragging === "end" ? "ring-2 ring-sky-300" : ""
                }`}
                style={{ left: `${selRightPct}%` }}
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span>início {formatTime(displayTimes.selectionStart)}</span>
          <span>fim {formatTime(displayTimes.selectionEnd)}</span>
          <span>
            playhead{" "}
            {formatTime(playheadAbs - material.startSec)}
          </span>
        </div>
      </div>

      {selectionPending && (
        <div className="space-y-2 rounded border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-sm">
          <p className="text-amber-100">
            Seleção diferente do material. Nada foi cortado ainda.
          </p>
          <p className="text-xs text-amber-200/90">
            Será removido:{" "}
            {displayTimes.excludedHead > 0.05
              ? `${formatTime(displayTimes.excludedHead)} do início`
              : "nada do início"}
            {displayTimes.excludedHead > 0.05 &&
            displayTimes.excludedTail > 0.05
              ? " · "
              : ""}
            {displayTimes.excludedTail > 0.05
              ? `${formatTime(displayTimes.excludedTail)} do fim`
              : displayTimes.excludedHead <= 0.05
                ? "nada do fim"
                : ""}
            . Duração resultante:{" "}
            {formatTime(displayTimes.selectionDuration)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cutBusy}
              onClick={onConfirmCut}
              className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
            >
              cortar aqui
            </button>
            <button
              type="button"
              disabled={cutBusy}
              onClick={onResetSelection}
              className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
            >
              voltar ao material inteiro
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          início
          <input
            type="text"
            inputMode="text"
            value={startInput}
            onChange={(e) => onStartInputChange(e.target.value)}
            onBlur={onStartInputBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="mt-1 block w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
          />
          {startTimeError && (
            <span className="ml-1 text-xs text-red-400">hora inválida</span>
          )}
        </label>
        <label className="text-sm">
          fim
          <input
            type="text"
            inputMode="text"
            value={endInput}
            onChange={(e) => onEndInputChange(e.target.value)}
            onBlur={onEndInputBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="mt-1 block w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono"
          />
          {endTimeError && (
            <span className="ml-1 text-xs text-red-400">hora inválida</span>
          )}
        </label>
        <button
          type="button"
          onClick={onPlayPreview}
          className="rounded bg-sky-700 px-3 py-2 text-sm hover:bg-sky-600"
        >
          ver seleção
        </button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeStartMinus1}
        >
          início −1s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeStartMinus05}
        >
          início −0,5s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeStartPlus05}
        >
          início +0,5s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeStartPlus1}
        >
          início +1s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeEndMinus1}
        >
          fim −1s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeEndMinus05}
        >
          fim −0,5s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeEndPlus05}
        >
          fim +0,5s
        </button>
        <button
          type="button"
          className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          onClick={onNudgeEndPlus1}
        >
          fim +1s
        </button>
      </div>
    </div>
  );
}
