import { useEffect, useRef } from "react";
import type { EmotionPresetId } from "../../../../../lib/emotionPresets";
import { EMOTION_PRESET_META } from "../../../../../lib/emotionPresets";

const FPS_FALLBACK = 60;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT") {
    const input = target as HTMLInputElement;
    // Library preset checkboxes should still receive editor shortcuts (e.g. undo).
    if (input.type === "checkbox" || input.type === "radio") return false;
    return true;
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export type EditorKeyboardActions = {
  togglePlayPause: () => void;
  markTrimStart: () => void;
  markTrimEnd: () => void;
  seekByFrames: (deltaFrames: number) => void;
  seekBySeconds: (deltaSeconds: number) => void;
  onJ: () => void;
  onK: () => void;
  onL: () => void;
  applyPresetByIndex: (index: number) => void;
  undo: () => void;
  getVideoFps: () => number | null;
};

export function useEditorKeyboard(
  enabled: boolean,
  actions: EditorKeyboardActions
): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        actionsRef.current.undo();
        return;
      }

      const key = e.key;
      const shift = e.shiftKey;

      if (key === " " || key === "Spacebar") {
        e.preventDefault();
        actionsRef.current.togglePlayPause();
        return;
      }

      if (key === "i" || key === "I") {
        e.preventDefault();
        actionsRef.current.markTrimStart();
        return;
      }

      if (key === "o" || key === "O") {
        e.preventDefault();
        actionsRef.current.markTrimEnd();
        return;
      }

      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault();
        const dir = key === "ArrowRight" ? 1 : -1;
        if (shift) {
          actionsRef.current.seekBySeconds(dir);
        } else {
          const fps =
            actionsRef.current.getVideoFps() ?? FPS_FALLBACK;
          actionsRef.current.seekByFrames(dir / fps);
        }
        return;
      }

      if (key === "j" || key === "J") {
        e.preventDefault();
        actionsRef.current.onJ();
        return;
      }

      if (key === "k" || key === "K") {
        e.preventDefault();
        actionsRef.current.onK();
        return;
      }

      if (key === "l" || key === "L") {
        e.preventDefault();
        actionsRef.current.onL();
        return;
      }

      if (/^[1-6]$/.test(key)) {
        e.preventDefault();
        const idx = Number(key) - 1;
        if (idx >= 0 && idx < EMOTION_PRESET_META.length) {
          actionsRef.current.applyPresetByIndex(idx);
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

export function presetIdAtUiIndex(index: number): EmotionPresetId | null {
  const meta = EMOTION_PRESET_META[index];
  return meta?.id ?? null;
}
