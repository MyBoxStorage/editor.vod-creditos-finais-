"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchEffectsLibrary,
  libraryMediaUrl,
  type EffectLibraryItem,
} from "../../../../../../lib/api";
import {
  DEFAULT_CLOSING_DURATION_SEC,
  type CompositionClosingSettings,
} from "../../../../../../lib/compositionClosingSettings";
import { formatClipTime } from "../../../../../../lib/finalizationTime";

type Props = {
  closingSettings: CompositionClosingSettings;
  onClosingSettingsChange: (settings: CompositionClosingSettings) => void;
  loopEnabled: boolean;
};

export function FechamentoTab({
  closingSettings,
  onClosingSettingsChange,
  loopEnabled,
}: Props) {
  const [items, setItems] = useState<EffectLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [videos, images] = await Promise.all([
          fetchEffectsLibrary({ type: "video" }),
          fetchEffectsLibrary({ type: "image" }),
        ]);
        if (!cancelled) {
          setItems([...videos, ...images]);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    (patch: Partial<CompositionClosingSettings>) => {
      onClosingSettingsChange({ ...closingSettings, ...patch });
    },
    [closingSettings, onClosingSettingsChange]
  );

  const selected = items.find((i) => i.id === closingSettings.libraryItemId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Recurso opcional (~4,6% dos clipes usam outro). Desligado por padrão.
      </p>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={closingSettings.enabled ?? false}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        anexar fechamento ao final
      </label>

      {closingSettings.enabled && loopEnabled && (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Fechamento quebra o loop — desligue o loop ou o fechamento antes de
          exportar.
        </div>
      )}

      {closingSettings.enabled && (
        <>
          <label className="block text-sm">
            <span className="text-xs text-zinc-400">duração</span>
            <input
              type="number"
              min={0.3}
              max={10}
              step={0.1}
              value={closingSettings.durationSec ?? DEFAULT_CLOSING_DURATION_SEC}
              onChange={(e) =>
                update({ durationSec: Number(e.target.value) || 1.5 })
              }
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
            />
            <span className="text-[10px] text-zinc-600">
              padrão {formatClipTime(DEFAULT_CLOSING_DURATION_SEC)}
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={closingSettings.fadeIn !== false}
              onChange={(e) => update({ fadeIn: e.target.checked })}
            />
            fade de entrada (curva linear)
          </label>

          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-400">biblioteca</p>
            {loading && (
              <p className="text-xs text-zinc-500">carregando…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="text-xs text-zinc-500">nenhum vídeo ou imagem na biblioteca</p>
            )}
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {items.map((item) => {
                const isSel = item.id === closingSettings.libraryItemId;
                const thumb = item.thumbnailPath
                  ? libraryMediaUrl(item.thumbnailPath)
                  : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => update({ libraryItemId: item.id })}
                    className={`rounded border p-2 text-left text-xs ${
                      isSel
                        ? "border-emerald-500 bg-emerald-900/30"
                        : "border-zinc-700 hover:border-zinc-600"
                    }`}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        className="mb-1 aspect-video w-full rounded object-cover"
                      />
                    ) : (
                      <div className="mb-1 flex aspect-video items-center justify-center rounded bg-zinc-800 text-zinc-600">
                        {item.type}
                      </div>
                    )}
                    <span className="line-clamp-2 text-zinc-300">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selected && (
            <p className="text-xs text-zinc-400">
              selecionado: {selected.name} · +{" "}
              {formatClipTime(
                closingSettings.durationSec ?? DEFAULT_CLOSING_DURATION_SEC
              )}{" "}
              na duração total
            </p>
          )}
        </>
      )}
    </div>
  );
}
