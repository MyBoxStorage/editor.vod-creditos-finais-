import { useCallback, useRef } from "react";
import type { ClipEffectInstance } from "../../../../../lib/api";
import type { PresetApplication } from "./presetApplications";

export type EditorSnapshot = {
  presetApplications: PresetApplication[];
  selectedApplicationId: string | null;
  appliedEffects: ClipEffectInstance[];
  segmentTexts: string[];
  /** Ajuste fino do trecho inteiro (aba ajuste fino, sem preset). */
  clipSpeed: number;
  clipZoomKeyframes: PresetApplication["zoomKeyframes"];
  clipColorPreset: PresetApplication["colorPreset"];
  clipSpeedRamp: PresetApplication["speedRamp"];
  /** Clip-relative selection within material (undo local only). */
  selectionStart: number;
  selectionEnd: number;
};

const MAX_UNDO = 24;

export function useEditorUndo() {
  const stackRef = useRef<EditorSnapshot[]>([]);

  const pushUndo = useCallback((snapshot: EditorSnapshot) => {
    const stack = stackRef.current;
    stack.push(snapshot);
    if (stack.length > MAX_UNDO) {
      stack.shift();
    }
  }, []);

  const popUndo = useCallback((): EditorSnapshot | null => {
    const stack = stackRef.current;
    if (stack.length === 0) return null;
    return stack.pop() ?? null;
  }, []);

  const canUndo = useCallback(() => stackRef.current.length > 0, []);

  const clearUndo = useCallback(() => {
    stackRef.current = [];
  }, []);

  return { pushUndo, popUndo, canUndo, clearUndo };
}
