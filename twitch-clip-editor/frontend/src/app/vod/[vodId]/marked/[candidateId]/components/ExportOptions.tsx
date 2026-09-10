import type { LayoutPreset, QualityId } from "../../../../../../lib/api";

const QUALITY_LABELS: Record<QualityId, string> = {
  draft: "rascunho",
  hd: "alta",
  max: "máxima",
};

type ExportOptionsProps = {
  layouts: LayoutPreset[];
  layoutPresetId: string;
  onLayoutPresetIdChange: (value: string) => void;
  quality: QualityId;
  onQualityChange: (value: QualityId) => void;
};

export function ExportOptions({
  layouts,
  layoutPresetId,
  onLayoutPresetIdChange,
  quality,
  onQualityChange,
}: ExportOptionsProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-sm">
        enquadramento
        <select
          value={layoutPresetId}
          onChange={(e) => onLayoutPresetIdChange(e.target.value)}
          className="mt-1 block min-w-64 rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
        >
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        qualidade
        <select
          value={quality}
          onChange={(e) => onQualityChange(e.target.value as QualityId)}
          className="mt-1 block rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
        >
          {(Object.keys(QUALITY_LABELS) as QualityId[]).map((id) => (
            <option key={id} value={id}>
              {QUALITY_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
