/**
 * CONTRATO §8 — invalidação centralizada do render fiel.
 *
 * Toda mudança em parâmetro que entra no render DEVE passar por dispatchEditorRenderParam
 * no page.tsx. Ao adicionar um controle novo:
 * 1. Não chame setState do parâmetro diretamente no JSX.
 * 2. Adicione um case em EditorRenderParamAction e trate em dispatchEditorRenderParam.
 * 3. Chame invalidateFaithfulPreview() dentro do dispatch (já feito pelo helper).
 *
 * Para sliders/arrastes: use { commit: false } durante o drag (só prévia rápida)
 * e { commit: true } ou omita commit no pointerup (dispara servidor se necessário).
 */

export type PreviewDisplayMode = "fast" | "faithful";

export type FaithfulPreviewState = {
  mode: PreviewDisplayMode;
  url: string | null;
  windowStart: number;
  windowEnd: number;
  cached: boolean;
  loading: boolean;
  excludedHook?: boolean;
  excludedWasted?: boolean;
};

export const INITIAL_FAITHFUL_PREVIEW: FaithfulPreviewState = {
  mode: "fast",
  url: null,
  windowStart: 0,
  windowEnd: 0,
  cached: false,
  loading: false,
  excludedHook: false,
  excludedWasted: false,
};

export function invalidateFaithfulPreviewState(
  prev: FaithfulPreviewState
): FaithfulPreviewState {
  if (prev.mode === "fast" && !prev.url && !prev.loading) {
    return prev;
  }
  return {
    ...INITIAL_FAITHFUL_PREVIEW,
    mode: "fast",
  };
}
