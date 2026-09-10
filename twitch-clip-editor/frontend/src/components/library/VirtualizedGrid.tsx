"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CARD_HEIGHT, CARD_HEIGHT_COMPACT, gridColumns } from "../../lib/libraryUtils";

type Props = {
  itemCount: number;
  density: "compact" | "wide";
  renderItem: (index: number) => ReactNode;
  className?: string;
  onReachEnd?: () => void;
};

export function VirtualizedGrid({
  itemCount,
  density,
  renderItem,
  className = "",
  onReachEnd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const cols = gridColumns(width, density);
  const rowCount = Math.ceil(itemCount / cols);
  const rowHeight = density === "compact" ? CARD_HEIGHT_COMPACT : CARD_HEIGHT;
  const overscan = 2;
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleRows =
    Math.ceil(height / rowHeight) + overscan * 2;
  const endRow = Math.min(rowCount, startRow + visibleRows);
  const totalHeight = rowCount * rowHeight;
  const startIndex = startRow * cols;
  const endIndex = Math.min(itemCount, endRow * cols);

  const items: ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i += 1) {
    items.push(
      <div key={i} className="min-w-0">
        {renderItem(i)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto ${className}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        setScrollTop(el.scrollTop);
        if (
          onReachEnd &&
          el.scrollTop + el.clientHeight >= el.scrollHeight - rowHeight * 2
        ) {
          onReachEnd();
        }
      }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          className="absolute left-0 right-0 grid gap-3 px-0.5"
          style={{
            top: startRow * rowHeight,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
        >
          {items}
        </div>
      </div>
    </div>
  );
}
