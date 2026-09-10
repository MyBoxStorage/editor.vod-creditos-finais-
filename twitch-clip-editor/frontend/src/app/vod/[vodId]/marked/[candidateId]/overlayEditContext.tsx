"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type OverlayDraftState = {
  active: boolean;
  mediaType: "video" | "image";
  name: string;
  src: string;
  positionX: number;
  positionY: number;
  positionWidth: number;
  positionHeight: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  clipTimestamp: number;
  overlayDuration: number;
  imageNativeWidth: number | null;
  aspectLocked: boolean;
};

const DEFAULT_DRAFT: OverlayDraftState = {
  active: false,
  mediaType: "video",
  name: "",
  src: "",
  positionX: 10,
  positionY: 10,
  positionWidth: 40,
  positionHeight: 40,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  clipTimestamp: 0,
  overlayDuration: 2,
  imageNativeWidth: null,
  aspectLocked: true,
};

type Ctx = {
  draft: OverlayDraftState;
  setDraft: (patch: Partial<OverlayDraftState>) => void;
  resetDraft: () => void;
};

const OverlayEditCtx = createContext<Ctx | null>(null);

export function OverlayEditProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<OverlayDraftState>(DEFAULT_DRAFT);

  const setDraft = useCallback((patch: Partial<OverlayDraftState>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraftState(DEFAULT_DRAFT);
  }, []);

  const value = useMemo(
    () => ({ draft, setDraft, resetDraft }),
    [draft, setDraft, resetDraft]
  );

  return (
    <OverlayEditCtx.Provider value={value}>{children}</OverlayEditCtx.Provider>
  );
}

export function useOverlayEdit() {
  const ctx = useContext(OverlayEditCtx);
  if (!ctx) {
    throw new Error("useOverlayEdit must be inside OverlayEditProvider");
  }
  return ctx;
}
