"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PreviewCtx = {
  playingId: string | null;
  playAudio: (id: string, url: string) => void;
  stopAudio: () => void;
  hoverVideoId: string | null;
  setHoverVideoId: (id: string | null) => void;
};

const Ctx = createContext<PreviewCtx | null>(null);

export function LibraryPreviewProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [hoverVideoId, setHoverVideoId] = useState<string | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  const playAudio = useCallback(
    (id: string, url: string) => {
      if (playingId === id) {
        stopAudio();
        return;
      }
      stopAudio();
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(id);
      audio.play().catch(() => undefined);
      audio.onended = () => setPlayingId(null);
    },
    [playingId, stopAudio]
  );

  useEffect(() => () => stopAudio(), [stopAudio]);

  return (
    <Ctx.Provider
      value={{
        playingId,
        playAudio,
        stopAudio,
        hoverVideoId,
        setHoverVideoId,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useLibraryPreview() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useLibraryPreview must be inside LibraryPreviewProvider");
  }
  return ctx;
}
