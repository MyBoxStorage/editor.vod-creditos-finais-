import type { ClipSegment } from "../../../../../../lib/api";

type ReusableSectionProps = {
  busy: boolean;
  showReusableForm: boolean;
  clipSegmentMeta: ClipSegment | null;
  reusableNameDraft: string;
  reusableTagsDraft: string;
  onReusableNameDraftChange: (value: string) => void;
  onReusableTagsDraftChange: (value: string) => void;
  onReusableCheckboxChange: (checked: boolean) => void;
  onApplyReusable: () => void;
};

export function ReusableSection({
  busy,
  showReusableForm,
  clipSegmentMeta,
  reusableNameDraft,
  reusableTagsDraft,
  onReusableNameDraftChange,
  onReusableTagsDraftChange,
  onReusableCheckboxChange,
  onApplyReusable,
}: ReusableSectionProps) {
  return (
    <div className="space-y-3 rounded border border-teal-900/60 bg-teal-950/20 p-3">
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={showReusableForm || !!clipSegmentMeta?.isReusable}
          disabled={busy}
          onChange={(e) => onReusableCheckboxChange(e.target.checked)}
        />
        guardar este trecho para reusar
      </label>
      {(showReusableForm || clipSegmentMeta?.isReusable) && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-zinc-400">
            Nome
            <input
              type="text"
              value={reusableNameDraft}
              onChange={(e) => onReusableNameDraftChange(e.target.value)}
              disabled={busy}
              placeholder="ex: reação engraçada"
              className="mt-1 block w-56 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Tags (vírgula)
            <input
              type="text"
              value={reusableTagsDraft}
              onChange={(e) => onReusableTagsDraftChange(e.target.value)}
              disabled={busy}
              placeholder="humor, reação"
              className="mt-1 block w-56 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={onApplyReusable}
            className="rounded border border-teal-600 bg-teal-950/60 px-3 py-1.5 text-sm text-teal-100 hover:bg-teal-900/80 disabled:opacity-50"
          >
            Salvar reutilizável
          </button>
        </div>
      )}
    </div>
  );
}
