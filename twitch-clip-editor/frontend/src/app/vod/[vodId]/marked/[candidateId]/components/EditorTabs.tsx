"use client";

import type { ReactNode } from "react";
import type { EditorTabId } from "../types";

const TAB_LABELS: Record<EditorTabId, string> = {
  cortar: "cortar",
  legendas: "legendas",
  momentos: "momentos",
  efeitos: "efeitos",
  ajuste_fino: "ajuste fino",
};

type EditorTabsProps = {
  activeTab: EditorTabId;
  onTabChange: (tab: EditorTabId) => void;
  tabIndicators: Record<EditorTabId, boolean>;
  tabAttention: Record<EditorTabId, boolean>;
  panels: Record<EditorTabId, ReactNode>;
};

export function EditorTabs({
  activeTab,
  onTabChange,
  tabIndicators,
  tabAttention,
  panels,
}: EditorTabsProps) {
  const tabs: EditorTabId[] = [
    "cortar",
    "legendas",
    "momentos",
    "efeitos",
    "ajuste_fino",
  ];

  return (
    <div className="min-w-0 flex-1 space-y-3">
      <div
        className="flex flex-wrap gap-1 border-b border-zinc-800 pb-1"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          const hasIndicator = tabIndicators[tab];
          const needsAttention = tabAttention[tab] && !isActive;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab)}
              className={`relative rounded-t px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              } ${needsAttention ? "ring-1 ring-amber-500/60" : ""}`}
            >
              {TAB_LABELS[tab]}
              {hasIndicator && (
                <span
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                    needsAttention ? "bg-amber-400" : "bg-sky-400"
                  }`}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-[280px]">
        {(Object.keys(panels) as EditorTabId[]).map((tab) => (
          <div
            key={tab}
            role="tabpanel"
            hidden={activeTab !== tab}
            className={
              activeTab === tab
                ? "block max-h-[70vh] overflow-y-auto"
                : "hidden"
            }
          >
            {panels[tab]}
          </div>
        ))}
      </div>
    </div>
  );
}
