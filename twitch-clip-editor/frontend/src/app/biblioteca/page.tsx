"use client";

import Link from "next/link";
import { useState } from "react";
import { BulkUploadWizard } from "../../components/library/BulkUploadWizard";
import { LibraryBrowser } from "../../components/library/LibraryBrowser";
import { LibraryPreviewProvider } from "../../components/library/useLibraryPreview";
import {
  archiveEffectLibraryItem,
  batchEffectLibrary,
  deleteEffectLibraryItem,
  toggleEffectLibraryFavorite,
  unarchiveEffectLibraryItem,
  updateEffectLibraryItem,
  uploadEffectLibraryItem,
  type EffectLibraryType,
} from "../../lib/api";
import { maxNativeWidthPercent } from "../../lib/overlayFade";
import {
  BACKGROUND_REMOVAL_LABELS,
  backgroundRemovalUsesColorParams,
  type BackgroundRemovalMode,
} from "../../lib/backgroundRemoval";

export default function BibliotecaPage() {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const [upName, setUpName] = useState("");
  const [upFile, setUpFile] = useState<File | null>(null);
  const [chromaColor, setChromaColor] = useState("#00FF00");
  const [chromaSim, setChromaSim] = useState(0.2);
  const [chromaBlend, setChromaBlend] = useState(0.1);
  const [bgMode, setBgMode] = useState<BackgroundRemovalMode>("chroma");

  const [imgName, setImgName] = useState("");
  const [imgFile, setImgFile] = useState<File | null>(null);

  function bumpRefresh() {
    setRefreshToken((t) => t + 1);
  }

  async function onToggleFavorite(item: { id: string }) {
    setBusy(true);
    try {
      await toggleEffectLibraryFavorite(item.id);
      bumpRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateItem(
    item: { id: string; name: string },
    patch: {
      name?: string;
      sensationTags?: string[];
      tags?: string[];
      backgroundRemovalMode?: string;
      chromaKeyColor?: string;
      chromaKeySimilarity?: number;
      chromaKeyBlend?: number;
    }
  ) {
    setBusy(true);
    try {
      await updateEffectLibraryItem(item.id, patch);
      bumpRefresh();
      setStatus("Item atualizado.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImageUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!imgFile || !imgName.trim()) {
      setError("Nome e arquivo são obrigatórios.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const item = await uploadEffectLibraryItem({
        type: "image",
        name: imgName.trim(),
        file: imgFile,
      });
      let msg = `Imagem “${imgName.trim()}” enviada.`;
      if (item.imageWidth != null && item.imageWidth > 0) {
        msg += ` Largura ${item.imageWidth}px — serve para ocupar até ${maxNativeWidthPercent(item.imageWidth).toFixed(0)}% da largura do clipe sem perder qualidade.`;
      }
      if (/\.(jpe?g)$/i.test(imgFile.name)) {
        msg += " JPG sem transparência — o overlay ficará com fundo.";
      }
      setStatus(msg);
      setImgName("");
      setImgFile(null);
      bumpRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSingleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!upFile || !upName.trim()) {
      setError("Nome e arquivo são obrigatórios.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadEffectLibraryItem({
        type: "video" as EffectLibraryType,
        name: upName.trim(),
        file: upFile,
        chromaKeyColor:
          bgMode === "chroma" ? chromaColor : bgMode === "solid" || bgMode === "luminance" ? "#000000" : chromaColor,
        chromaKeySimilarity: chromaSim,
        chromaKeyBlend: chromaBlend,
        backgroundRemovalMode: bgMode,
      });
      setStatus(`Item “${upName.trim()}” enviado.`);
      setUpName("");
      setUpFile(null);
      bumpRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteItem(item: { id: string; name: string }) {
    setBusy(true);
    setError("");
    try {
      await deleteEffectLibraryItem(item.id);
      bumpRefresh();
      setStatus(`Item “${item.name}” excluído.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onArchiveItem(item: { id: string; name: string }) {
    setBusy(true);
    setError("");
    try {
      await archiveEffectLibraryItem(item.id);
      bumpRefresh();
      setStatus(`Item “${item.name}” arquivado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onUnarchiveItem(item: { id: string; name: string }) {
    setBusy(true);
    setError("");
    try {
      await unarchiveEffectLibraryItem(item.id);
      bumpRefresh();
      setStatus(`Item “${item.name}” desarquivado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function runBatch(
    ids: string[],
    action: "archive" | "unarchive" | "favorite" | "delete"
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await batchEffectLibrary({ ids, action });
      setStatus(
        action === "delete"
          ? `${result.deleted} item(ns) apagado(s).`
          : `${result.updated} item(ns) atualizado(s).`
      );
      bumpRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <LibraryPreviewProvider>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
        <main className="mx-auto max-w-6xl space-y-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <Link href="/" className="hover:text-zinc-200">
                ← VODs
              </Link>
            </div>
            <h1 className="text-2xl font-semibold">Biblioteca</h1>
            <p className="text-sm text-zinc-400">
              Overlays de vídeo, imagens, músicas e efeitos sonoros reutilizáveis.
              Aplicação nos trechos fica no editor.
            </p>
          </header>

          {error && (
            <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          {status && (
            <p className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
              {status}
            </p>
          )}

          <section className="space-y-3 rounded border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="text-sm font-medium text-zinc-200">Upload em lote</h2>
            <BulkUploadWizard
              disabled={busy}
              onDone={() => {
                setStatus("Upload em lote concluído.");
                bumpRefresh();
              }}
              onError={setError}
            />
          </section>

          <section className="rounded border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <h2 className="text-sm font-medium text-zinc-200">
              Upload único (imagem PNG / WEBP / JPG)
            </h2>
            <form
              onSubmit={onImageUpload}
              className="flex flex-wrap gap-3 items-end"
            >
              <label className="text-xs text-zinc-400 flex-1 min-w-40">
                Nome
                <input
                  type="text"
                  value={imgName}
                  onChange={(e) => setImgName(e.target.value)}
                  disabled={busy}
                  className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Arquivo
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setImgFile(f);
                    if (f && !imgName.trim()) {
                      setImgName(f.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                  className="mt-1 block text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !imgFile || !imgName.trim()}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Enviar imagem
              </button>
            </form>
            <p className="text-[11px] text-zinc-500">
              PNG com transparência recomendado. JPG e WEBP aceitos, mas sem
              canal alpha o fundo aparece no overlay.
            </p>
          </section>

          <section className="rounded border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <h2 className="text-sm font-medium text-zinc-200">
              Upload único (vídeo overlay)
            </h2>
            <form
              onSubmit={onSingleUpload}
              className="flex flex-wrap gap-3 items-end"
            >
              <label className="text-xs text-zinc-400 flex-1 min-w-40">
                Nome
                <input
                  type="text"
                  value={upName}
                  onChange={(e) => setUpName(e.target.value)}
                  disabled={busy}
                  className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Arquivo
                <input
                  type="file"
                  accept="video/*,.mp4,.webm,.mov"
                  disabled={busy}
                  onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                remoção de fundo
                <select
                  value={bgMode}
                  disabled={busy}
                  onChange={(e) => {
                    const m = e.target.value as BackgroundRemovalMode;
                    setBgMode(m);
                    if (m === "solid" || m === "luminance" || m === "screen") {
                      setChromaColor("#000000");
                    }
                  }}
                  className="mt-1 block min-w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                >
                  {(Object.keys(BACKGROUND_REMOVAL_LABELS) as BackgroundRemovalMode[]).map(
                    (m) => (
                      <option key={m} value={m}>
                        {BACKGROUND_REMOVAL_LABELS[m]}
                      </option>
                    )
                  )}
                </select>
              </label>
              {backgroundRemovalUsesColorParams(bgMode) && (
                <label className="text-xs text-zinc-400">
                  Cor
                  <input
                    type="color"
                    value={chromaColor}
                    onChange={(e) => setChromaColor(e.target.value)}
                    disabled={busy}
                    className="mt-1 block h-8 w-10"
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={busy || !upFile || !upName.trim()}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Enviar
              </button>
            </form>
          </section>

          <LibraryBrowser
            density="wide"
            mode="manage"
            disabled={busy}
            refreshToken={refreshToken}
            gridHeightClass="h-[520px]"
            onToggleFavorite={(item) => void onToggleFavorite(item)}
            onUpdateItem={(item, patch) => void onUpdateItem(item, patch)}
            onDeleteItem={(item) => onDeleteItem(item)}
            onArchiveItem={(item) => onArchiveItem(item)}
            onUnarchiveItem={(item) => onUnarchiveItem(item)}
            onBatchArchive={(ids) => void runBatch(ids, "archive")}
            onBatchUnarchive={(ids) => void runBatch(ids, "unarchive")}
            onBatchFavorite={(ids) => void runBatch(ids, "favorite")}
            onBatchDelete={(ids) => void runBatch(ids, "delete")}
          />
        </main>
      </div>
    </LibraryPreviewProvider>
  );
}
