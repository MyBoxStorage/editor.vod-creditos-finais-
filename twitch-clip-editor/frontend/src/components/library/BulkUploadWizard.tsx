"use client";

import { useState } from "react";
import type { EffectLibraryType } from "../../lib/api";
import { bulkUploadEffectLibrary } from "../../lib/api";
import { detectTypeFromFileName } from "../../lib/libraryUtils";
import { SENSATION_TAGS, type SensationTag } from "../../lib/sensationTags";

type DraftItem = {
  file: File;
  name: string;
  type: EffectLibraryType;
  sensationTags: SensationTag[];
  freeTags: string;
};

type Props = {
  onDone: () => void;
  onError: (msg: string) => void;
  disabled?: boolean;
};

export function BulkUploadWizard({ onDone, onError, disabled }: Props) {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"pick" | "tag">("pick");

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: DraftItem[] = Array.from(files).map((file) => ({
      file,
      name: file.name.replace(/\.[^.]+$/, ""),
      type: detectTypeFromFileName(file.name),
      sensationTags: [],
      freeTags: "",
    }));
    setDrafts(next);
    setStep("tag");
  }

  async function onCommit() {
    if (drafts.length === 0) return;
    setBusy(true);
    try {
      await bulkUploadEffectLibrary({
        files: drafts.map((d) => d.file),
        items: drafts.map((d) => ({
          originalName: d.file.name,
          name: d.name.trim() || d.file.name,
          type: d.type,
          sensationTags: d.sensationTags,
          tags: d.freeTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        })),
      });
      setDrafts([]);
      setStep("pick");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "pick") {
    return (
      <label className="block cursor-pointer rounded border border-dashed border-zinc-600 bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-400 hover:border-amber-600">
        <input
          type="file"
          multiple
          disabled={disabled || busy}
          className="hidden"
          accept="video/*,audio/*,image/*,.mp4,.webm,.mov,.mp3,.m4a,.wav,.ogg,.png,.webp,.jpg,.jpeg,.gif"
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        Selecionar vários arquivos (tipo detectado pela extensão)
      </label>
    );
  }

  return (
    <div className="space-y-3 rounded border border-zinc-700 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-zinc-200">
          Nomear e marcar tags ({drafts.length} arquivos)
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDrafts([]);
            setStep("pick");
          }}
          className="text-xs text-zinc-400 underline"
        >
          cancelar
        </button>
      </div>
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {drafts.map((d, i) => (
          <li
            key={`${d.file.name}-${i}`}
            className="rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-2"
          >
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={d.name}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => {
                    const copy = [...prev];
                    copy[i] = { ...copy[i], name: e.target.value };
                    return copy;
                  })
                }
                className="min-w-32 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
              />
              <select
                value={d.type}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => {
                    const copy = [...prev];
                    copy[i] = {
                      ...copy[i],
                      type: e.target.value as EffectLibraryType,
                    };
                    return copy;
                  })
                }
                className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
              >
                <option value="video">Vídeo</option>
                <option value="music">Música</option>
                <option value="sfx">Efeito sonoro</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-1">
              {SENSATION_TAGS.map((tag) => {
                const on = d.sensationTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setDrafts((prev) => {
                        const copy = [...prev];
                        const tags = on
                          ? copy[i].sensationTags.filter((t) => t !== tag)
                          : [...copy[i].sensationTags, tag];
                        copy[i] = { ...copy[i], sensationTags: tags };
                        return copy;
                      })
                    }
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      on
                        ? "border-amber-600 bg-amber-950/50 text-amber-100"
                        : "border-zinc-700 text-zinc-500"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={d.freeTags}
              disabled={busy}
              placeholder="tags livres, separadas por vírgula"
              onChange={(e) =>
                setDrafts((prev) => {
                  const copy = [...prev];
                  copy[i] = { ...copy[i], freeTags: e.target.value };
                  return copy;
                })
              }
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
            />
            <p className="text-[10px] text-zinc-600 truncate">{d.file.name}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || drafts.some((d) => !d.name.trim())}
        onClick={() => void onCommit()}
        className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium hover:bg-amber-500 disabled:opacity-50"
      >
        {busy ? "Enviando…" : "Enviar todos para biblioteca"}
      </button>
    </div>
  );
}
