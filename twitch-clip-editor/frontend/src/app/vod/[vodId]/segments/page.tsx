"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createComposition,
  fetchClipSegments,
  type ClipSegment,
  type ClipSegmentStatus,
} from "../../../../lib/api";
import { formatClipTime } from "../../../../lib/finalizationTime";

type Props = {
  params: Promise<{ vodId: string }>;
};

function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function statusLabel(status: ClipSegmentStatus): string {
  switch (status) {
    case "marked":
      return "Marcado";
    case "trimmed":
      return "Cortado";
    case "transcribed":
      return "Transcrito";
    case "exported":
      return "Exportado";
    default:
      return status;
  }
}

function statusClass(status: ClipSegmentStatus): string {
  switch (status) {
    case "exported":
      return "border-emerald-700 bg-emerald-950/50 text-emerald-200";
    case "transcribed":
      return "border-sky-700 bg-sky-950/50 text-sky-200";
    case "trimmed":
      return "border-amber-700 bg-amber-950/50 text-amber-200";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

export default function ClipSegmentsDrawerPage({ params }: Props) {
  const [vodId, setVodId] = useState("");
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then((p) => setVodId(p.vodId));
  }, [params]);

  useEffect(() => {
    if (!vodId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchClipSegments(vodId);
        if (!cancelled) {
          setSegments(data.clipSegments ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setSegments([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createFinalization() {
    if (selectedIds.size === 0) return;
    setCreating(true);
    setError("");
    try {
      const ordered = segments
        .filter((s) => selectedIds.has(s.id))
        .sort((a, b) => a.sourceStart - b.sourceStart)
        .map((s) => s.id);
      const comp = await createComposition({ vodId, clipSegmentIds: ordered });
      window.location.href = `/vod/${vodId}/finalizacao/${comp.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <main className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-200">
              ← VODs
            </Link>
            <span>·</span>
            <Link href={`/vod/${vodId}`} className="hover:text-zinc-200">
              Timeline
            </Link>
            <span>·</span>
            <Link
              href={`/vod/${vodId}/marked`}
              className="hover:text-zinc-200"
            >
              Candidatos marcados
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Gaveta de edição</h1>
          <p className="text-sm text-zinc-400">
            {vodId} · clip_segments em ordem cronológica no VOD
          </p>
          <p className="text-sm text-zinc-500">
            Clique num card para abrir o editor de trecho. Selecione vários para
            criar uma edição final.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href={`/vod/${vodId}/finalizacao`}
              className="text-sm text-sky-400 hover:underline"
            >
              Ver edições finais →
            </Link>
            {selectedIds.size > 0 && (
              <button
                type="button"
                disabled={creating}
                onClick={createFinalization}
                className="rounded bg-fuchsia-800 px-3 py-1 text-sm hover:bg-fuchsia-700 disabled:opacity-50"
              >
                {creating
                  ? "Criando…"
                  : `Criar edição final (${selectedIds.size})`}
              </button>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {loading && (
          <p className="text-sm text-zinc-500">Carregando trechos…</p>
        )}

        {!loading && !error && segments.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nenhum trecho na gaveta. Abra um candidato e use{" "}
            <span className="text-zinc-300">Enviar para edição</span>.
          </p>
        )}

        <ul className="space-y-3">
          {segments.map((s) => {
            const isHook = s.role === "hook";
            return (
              <li key={s.id}>
                <div
                  className={`flex w-full rounded border p-3 text-left transition-colors ${
                    isHook
                      ? "border-fuchsia-700/80 bg-fuchsia-950/30"
                      : "border-zinc-800 bg-zinc-900/60"
                  } ${selectedIds.has(s.id) ? "ring-1 ring-fuchsia-500" : ""}`}
                >
                  <label className="mr-3 flex shrink-0 items-start pt-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded"
                    />
                  </label>
                  <Link
                    href={`/vod/${vodId}/marked/${s.id}`}
                    className="flex min-w-0 flex-1 gap-4 hover:opacity-90"
                  >
                    <div className="flex h-[90px] w-[160px] shrink-0 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                      Sem thumb
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-2 py-0.5 text-xs ${statusClass(s.status)}`}
                        >
                          {statusLabel(s.status)}
                        </span>
                        {isHook && (
                          <span className="rounded border border-fuchsia-600 bg-fuchsia-900/60 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-fuchsia-100">
                            Gancho
                          </span>
                        )}
                        {s.isReusable && (
                          <span className="rounded border border-teal-700 bg-teal-950/50 px-2 py-0.5 text-xs text-teal-200">
                            Reutilizável
                            {s.reusableName ? `: ${s.reusableName}` : ""}
                          </span>
                        )}
                        <span className="text-xs text-zinc-500">
                          {s.sourceType}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-200">
                        {formatTime(s.sourceStart)} – {formatTime(s.sourceEnd)}
                        <span className="ml-2 text-xs text-zinc-500">
                          ({(s.sourceEnd - s.sourceStart).toFixed(1)}s)
                        </span>
                      </p>
                      <p className="truncate font-mono text-xs text-zinc-500">
                        {s.id}
                      </p>
                    </div>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
