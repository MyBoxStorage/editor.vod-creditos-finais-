"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  candidateThumbnailUrl,
  fetchMarkedCandidates,
  type MarkedCandidate,
  type MarkedCandidateStatus,
} from "../../../../lib/api";

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

function statusLabel(status: MarkedCandidateStatus): string {
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

function statusClass(status: MarkedCandidateStatus): string {
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

export default function MarkedCandidatesPage({ params }: Props) {
  const router = useRouter();
  const [vodId, setVodId] = useState("");
  const [candidates, setCandidates] = useState<MarkedCandidate[]>([]);
  const [markedAt, setMarkedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
        const file = await fetchMarkedCandidates(vodId);
        if (!cancelled) {
          setCandidates(file.candidates ?? []);
          setMarkedAt(file.markedAt ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCandidates([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  const selectedList = useMemo(
    () => candidates.filter((c) => selectedIds.has(c.id)),
    [candidates, selectedIds]
  );

  const nonExportedSelected = selectedList.filter((c) => c.status !== "exported");

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goMerge() {
    if (selectedList.length < 2) {
      setError("Selecione pelo menos 2 candidatos para juntar.");
      return;
    }
    if (nonExportedSelected.length > 0) {
      setError(
        `Merge só aceita status "exported". Inválidos: ${nonExportedSelected
          .map((c) => c.id)
          .join(", ")}`
      );
      return;
    }
    const ids = selectedList.map((c) => c.id).join(",");
    router.push(`/vod/${vodId}/marked/merge?ids=${encodeURIComponent(ids)}`);
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
              Editor legado
            </Link>
            <span>·</span>
            <Link
              href={`/vod/${vodId}/segments`}
              className="hover:text-sky-300 text-sky-400"
            >
              Gaveta de edição
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Candidatos marcados</h1>
          <p className="text-sm text-zinc-400">
            {vodId}
            {markedAt
              ? ` · marcados em ${new Date(markedAt).toLocaleString()}`
              : ""}
          </p>
          <p className="text-sm text-zinc-500">
            Clique no card para editar · checkbox para seleção múltipla / merge
          </p>
        </header>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-700 bg-zinc-900/80 px-3 py-2">
            <span className="text-sm text-zinc-300">
              {selectedIds.size} selecionado{selectedIds.size === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={goMerge}
              className="rounded bg-fuchsia-700 px-3 py-1.5 text-sm hover:bg-fuchsia-600"
            >
              Juntar selecionados
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
            >
              Limpar seleção
            </button>
          </div>
        )}

        {error && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {loading && (
          <p className="text-sm text-zinc-500">Carregando candidatos…</p>
        )}

        {!loading && !error && candidates.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nenhum candidato marcado. Rode{" "}
            <code className="text-zinc-300">
              POST /vod/{vodId}/mark-candidates
            </code>{" "}
            primeiro.
          </p>
        )}

        <ul className="space-y-3">
          {candidates.map((c) => (
            <li key={c.id}>
              <div className="flex gap-3 rounded border border-zinc-800 bg-zinc-900/60 p-3 hover:border-zinc-600">
                <label className="flex shrink-0 items-start pt-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => {
                      setError("");
                      toggleSelect(c.id);
                    }}
                    className="h-4 w-4"
                    title={
                      c.status === "exported"
                        ? "Selecionar para merge"
                        : "Merge exige status exported"
                    }
                  />
                </label>
                <Link
                  href={`/vod/${vodId}/marked/${c.id}`}
                  className="flex min-w-0 flex-1 gap-4"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={candidateThumbnailUrl(c.id)}
                    alt=""
                    width={160}
                    height={90}
                    className="h-[90px] w-[160px] shrink-0 rounded bg-zinc-800 object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${statusClass(c.status)}`}
                      >
                        {statusLabel(c.status)}
                      </span>
                      <span className="text-xs text-zinc-500">
                        score {c.score}
                      </span>
                      <span className="text-xs text-zinc-500">{c.origin}</span>
                    </div>
                    <p className="text-sm leading-snug text-zinc-200">
                      {c.reason || "(sem reason)"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatTime(c.originalStart ?? c.start)} –{" "}
                      {formatTime(c.originalEnd ?? c.end)}
                      {(c.originalStart != null || c.originalEnd != null) &&
                        (c.start !== c.originalStart ||
                          c.end !== c.originalEnd) && (
                          <span className="text-zinc-400">
                            {" "}
                            · atual {formatTime(c.start)}–{formatTime(c.end)}
                          </span>
                        )}
                    </p>
                  </div>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
