"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  EXPORT_FRAME_WIDTH,
  maxNativeWidthPercent,
} from "../../../../../../lib/overlayFade";

type Props = {
  positionX: number;
  positionY: number;
  positionWidth: number;
  positionHeight: number;
  aspectLocked: boolean;
  imageNativeWidth?: number | null;
  onChange: (patch: {
    positionX?: number;
    positionY?: number;
    positionWidth?: number;
    positionHeight?: number;
  }) => void;
  onAspectLockedChange?: (locked: boolean) => void;
  children: ReactNode;
};

type DragMode = "move" | "se" | null;

export function OverlayTransformEditor({
  positionX,
  positionY,
  positionWidth,
  positionHeight,
  aspectLocked,
  imageNativeWidth,
  onChange,
  onAspectLockedChange,
  children,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const anchor = useRef({
    px: 0,
    py: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    aspect: 1,
  });

  const upscaleWarning =
    imageNativeWidth != null &&
    imageNativeWidth > 0 &&
    (positionWidth / 100) * EXPORT_FRAME_WIDTH > imageNativeWidth;

  function onPointerDownMove(e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("move");
    anchor.current = {
      px: e.clientX,
      py: e.clientY,
      x: positionX,
      y: positionY,
      w: positionWidth,
      h: positionHeight,
      aspect: positionWidth / Math.max(positionHeight, 0.01),
    };
  }

  function onPointerDownResize(e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("se");
    anchor.current = {
      px: e.clientX,
      py: e.clientY,
      x: positionX,
      y: positionY,
      w: positionWidth,
      h: positionHeight,
      aspect: positionWidth / Math.max(positionHeight, 0.01),
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragMode || !boxRef.current?.parentElement) return;
    const parent = boxRef.current.parentElement.getBoundingClientRect();
    const dxPct = ((e.clientX - anchor.current.px) / parent.width) * 100;
    const dyPct = ((e.clientY - anchor.current.py) / parent.height) * 100;

    if (dragMode === "move") {
      onChange({
        positionX: Math.max(
          0,
          Math.min(100 - anchor.current.w, anchor.current.x + dxPct)
        ),
        positionY: Math.max(
          0,
          Math.min(100 - anchor.current.h, anchor.current.y + dyPct)
        ),
      });
      return;
    }

    let nw = Math.max(
      5,
      Math.min(100 - anchor.current.x, anchor.current.w + dxPct)
    );
    let nh = Math.max(
      5,
      Math.min(100 - anchor.current.y, anchor.current.h + dyPct)
    );
    if (aspectLocked) {
      nh = nw / anchor.current.aspect;
      if (anchor.current.y + nh > 100) {
        nh = 100 - anchor.current.y;
        nw = nh * anchor.current.aspect;
      }
    }
    onChange({ positionWidth: nw, positionHeight: nh });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (dragMode) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragMode(null);
    }
  }

  return (
    <div
      ref={boxRef}
      className="absolute z-20 overflow-visible border-2 border-sky-400/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
      style={{
        left: `${positionX}%`,
        top: `${positionY}%`,
        width: `${positionWidth}%`,
        height: `${positionHeight}%`,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute inset-0 cursor-move"
        onPointerDown={onPointerDownMove}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label="Redimensionar"
        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-sky-500"
        onPointerDown={onPointerDownResize}
      />
      <div className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-black/75 px-1 text-[9px] text-zinc-200">
        {positionX.toFixed(0)}% · {positionY.toFixed(0)}% ·{" "}
        {positionWidth.toFixed(0)}×{positionHeight.toFixed(0)}%
      </div>
      {onAspectLockedChange && (
        <button
          type="button"
          className="absolute -top-5 right-0 rounded bg-black/75 px-1 text-[9px] text-zinc-300"
          onClick={(e) => {
            e.stopPropagation();
            onAspectLockedChange(!aspectLocked);
          }}
        >
          {aspectLocked ? "🔒" : "🔓"}
        </button>
      )}
      {upscaleWarning && imageNativeWidth != null && (
        <p className="pointer-events-none absolute bottom-full left-0 mb-0.5 max-w-[160px] text-[8px] leading-tight text-amber-200/90">
          acima da largura nativa ({imageNativeWidth}px) — ideal ≤{" "}
          {maxNativeWidthPercent(imageNativeWidth).toFixed(0)}%
        </p>
      )}
    </div>
  );
}
