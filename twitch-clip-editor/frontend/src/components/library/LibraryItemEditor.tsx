"use client";

import { useEffect, useState } from "react";
import type { EffectLibraryCard } from "../../lib/api";
import { fetchEffectLibraryItem } from "../../lib/api";
import {
  BACKGROUND_REMOVAL_LABELS,
  backgroundRemovalUsesColorParams,
  parseBackgroundRemovalMode,
  type BackgroundRemovalMode,
} from "../../lib/backgroundRemoval";
import { SensationTagPicker } from "./SensationTagPicker";

type Props = {
  item: EffectLibraryCard;
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSave: (
    item: EffectLibraryCard,
    patch: {
      name?: string;
      sensationTags?: string[];
      tags?: string[];
      backgroundRemovalMode?: BackgroundRemovalMode;
      chromaKeyColor?: string;
      chromaKeySimilarity?: number;
      chromaKeyBlend?: number;
    }
  ) => void | Promise<void>;
  onDelete?: (item: EffectLibraryCard) => void | Promise<void>;
  onArchive?: (item: EffectLibraryCard) => void | Promise<void>;
  onUnarchive?: (item: EffectLibraryCard) => void | Promise<void>;
};

export function LibraryItemEditor({
  item,
  open,
  disabled,
  onClose,
  onSave,
  onDelete,
  onArchive,
  onUnarchive,
}: Props) {
  const [name, setName] = useState(item.name);
  const [freeTags, setFreeTags] = useState(item.tags.join(", "));
  const [sensationTags, setSensationTags] = useState<string[]>(
    item.sensationTags
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [bgMode, setBgMode] = useState<BackgroundRemovalMode>("chroma");
  const [chromaColor, setChromaColor] = useState("#00FF00");
  const [chromaSim, setChromaSim] = useState(0.2);
  const [chromaBlend, setChromaBlend] = useState(0.1);

  useEffect(() => {
    if (!open || item.type !== "video") return;
    let cancelled = false;
    (async () => {
      try {
        const full = await fetchEffectLibraryItem(item.id);
        if (cancelled) return;
        setBgMode(parseBackgroundRemovalMode(full.backgroundRemovalMode));
        setChromaColor(full.chromaKeyColor ?? "#000000");
        setChromaSim(full.chromaKeySimilarity ?? 0.2);
        setChromaBlend(full.chromaKeyBlend ?? 0.1);
      } catch {
        // keep defaults
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item.id, item.type]);

  useEffect(() => {
    if (!open) return;
    setName(item.name);
    setFreeTags(item.tags.join(", "));
    setSensationTags(item.sensationTags);
    setConfirmDelete(false);
    setActionError("");
  }, [open, item]);

  if (!open) return null;

  function toggleSensation(tag: string) {
    setSensationTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const tags = freeTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      await onSave(item, {
        name: trimmed,
        tags,
        sensationTags,
        ...(item.type === "video"
          ? {
              backgroundRemovalMode: bgMode,
              chromaKeyColor: chromaColor,
              chromaKeySimilarity: chromaSim,
              chromaKeyBlend: chromaBlend,
            }
          : {}),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function runArchive() {
    if (!onArchive) return;
    setActionBusy(true);
    setActionError("");
    try {
      await onArchive(item);
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  async function runUnarchive() {
    if (!onUnarchive) return;
    setActionBusy(true);
    setActionError("");
    try {
      await onUnarchive(item);
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  async function runDelete() {
    if (!onDelete) return;
    setActionBusy(true);
    setActionError("");
    try {
      await onDelete(item);
      onClose();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setConfirmDelete(false);
    } finally {
      setActionBusy(false);
    }
  }

  const busy = disabled || saving || actionBusy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      data-testid="library-item-editor"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-sm font-medium text-zinc-100">Editar item</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={actionBusy}
            className="text-zinc-500 hover:text-zinc-300"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <label className="mb-3 block text-xs text-zinc-400">
          Nome
          <input
            type="text"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            data-testid="library-edit-name"
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          />
        </label>

        <label className="mb-3 block text-xs text-zinc-400">
          Tags livres (separadas por vírgula)
          <input
            type="text"
            value={freeTags}
            disabled={busy}
            onChange={(e) => setFreeTags(e.target.value)}
            data-testid="library-edit-tags"
            className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100"
          />
        </label>

        <div className="mb-4 space-y-2">
          <p className="text-xs text-zinc-400">Tags de sensação</p>
          <SensationTagPicker
            selected={sensationTags}
            onToggle={toggleSensation}
            disabled={busy}
          />
        </div>

        {item.type === "video" && (
          <div className="mb-4 space-y-3 rounded border border-zinc-800 p-3">
            <p className="text-xs font-medium text-zinc-300">
              remoção de fundo
            </p>
            <select
              value={bgMode}
              disabled={busy}
              onChange={(e) =>
                setBgMode(e.target.value as BackgroundRemovalMode)
              }
              className="block w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
            >
              {(Object.keys(BACKGROUND_REMOVAL_LABELS) as BackgroundRemovalMode[]).map(
                (m) => (
                  <option key={m} value={m}>
                    {BACKGROUND_REMOVAL_LABELS[m]}
                  </option>
                )
              )}
            </select>
            {backgroundRemovalUsesColorParams(bgMode) && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-zinc-400">
                  cor
                  <input
                    type="color"
                    value={chromaColor}
                    disabled={busy}
                    onChange={(e) => setChromaColor(e.target.value)}
                    className="mt-1 block h-8 w-12"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  similaridade
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={chromaSim}
                    disabled={busy}
                    onChange={(e) => setChromaSim(Number(e.target.value))}
                    className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  suavização
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={chromaBlend}
                    disabled={busy}
                    onChange={(e) => setChromaBlend(Number(e.target.value))}
                    className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-800 pt-4">
          <button
            type="button"
            disabled={actionBusy}
            onClick={onClose}
            className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void handleSave()}
            data-testid="library-edit-save"
            className="rounded bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>

        {(onArchive || onUnarchive) && (
          <div className="mt-4 border-t border-zinc-800 pt-4">
            {item.status === "archived" && onUnarchive ? (
              <button
                type="button"
                disabled={busy}
                data-testid="library-edit-unarchive"
                onClick={() => void runUnarchive()}
                className="rounded border border-lime-800 px-3 py-1.5 text-xs text-lime-200 hover:border-lime-600 disabled:opacity-50"
              >
                {actionBusy ? "Processando…" : "Desarquivar"}
              </button>
            ) : (
              onArchive && (
                <button
                  type="button"
                  disabled={busy}
                  data-testid="library-edit-archive"
                  onClick={() => void runArchive()}
                  className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                >
                  {actionBusy ? "Processando…" : "Arquivar"}
                </button>
              )
            )}
            <p className="mt-1.5 text-[10px] text-zinc-600">
              Arquivar oculta da navegação, mas mantém o arquivo — reversível.
            </p>
          </div>
        )}

        {onDelete && (
          <div className="mt-6 border-t border-red-950/80 pt-4">
            {!confirmDelete ? (
              <button
                type="button"
                disabled={busy}
                data-testid="library-edit-delete"
                onClick={() => {
                  setActionError("");
                  setConfirmDelete(true);
                }}
                className="text-xs text-red-400/90 underline-offset-2 hover:text-red-300 hover:underline disabled:opacity-50"
              >
                Excluir permanentemente…
              </button>
            ) : (
              <div
                className="space-y-3 rounded border border-red-900/60 bg-red-950/20 p-3"
                data-testid="library-delete-confirm"
              >
                <p className="text-sm font-medium text-red-100">
                  Excluir “{item.name}”?
                </p>
                <p className="text-xs text-red-200/80">
                  O arquivo será removido do disco. Esta ação é definitiva e não
                  pode ser desfeita.
                </p>
                <p className="text-xs text-zinc-400">
                  Prefere só ocultar?{" "}
                  <strong className="font-normal text-zinc-300">
                    Arquivar
                  </strong>{" "}
                  some da navegação, mantém o arquivo e é reversível.
                </p>
                {actionError && (
                  <p
                    className="text-xs text-red-300"
                    data-testid="library-delete-error"
                  >
                    {actionError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => setConfirmDelete(false)}
                    className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
                  >
                    Voltar
                  </button>
                  {onArchive && item.status !== "archived" && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      data-testid="library-delete-archive-instead"
                      onClick={() => void runArchive()}
                      className="rounded border border-zinc-500 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-400 disabled:opacity-50"
                    >
                      Arquivar
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={actionBusy}
                    data-testid="library-delete-confirm-btn"
                    onClick={() => void runDelete()}
                    className="rounded border border-red-700 bg-red-950/60 px-3 py-1.5 text-xs text-red-100 hover:border-red-500 disabled:opacity-50"
                  >
                    {actionBusy ? "Excluindo…" : "Excluir permanentemente"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {actionError && !confirmDelete && (
          <p className="mt-3 text-xs text-red-300">{actionError}</p>
        )}
      </div>
    </div>
  );
}
