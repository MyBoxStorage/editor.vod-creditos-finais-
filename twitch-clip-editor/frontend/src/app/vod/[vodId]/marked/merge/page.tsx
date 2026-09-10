"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  apiUrl,
  candidateThumbnailUrl,
  fetchMarkedCandidates,
  mergeMarkedCandidates,
  type MarkedCandidate,
  type QualityId,
} from "../../../../../lib/api";

type Props = {
  params: Promise<{ vodId: string }>;
};

function MergeInner({ vodId }: { vodId: string }) {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";

  const initialIds = useMemo(
    () =>
      idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [idsParam]
  );

  const [orderedIds, setOrderedIds] = useState<string[]>(initialIds);
  const [byId, setById] = useState<Record<string, MarkedCandidate>>({});
  const [quality, setQuality] = useState<QualityId>("hd");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    setOrderedIds(initialIds);
  }, [initialIds]);

  useEffect(() => {
    if (!vodId || initialIds.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const file = await fetchMarkedCandidates(vodId);
        if (cancelled) return;
        const map: Record<string, MarkedCandidate> = {};
        for (const c of file.candidates ?? []) {
          map[c.id] = c;
        }
        setById(map);
        const missing = initialIds.filter((id) => !map[id]);
        const notExported = initialIds.filter(
          (id) => map[id] && map[id].status !== "exported"
        );
        if (missing.length || notExported.length) {
          setError(
            [
              missing.length
                ? `Não encontrados: ${missing.join(", ")}`
                : null,
              notExported.length
                ? `Não exported: ${notExported.join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          );
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId, initialIds]);

  function move(index: number, dir: -1 | 1) {
    setOrderedIds((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
  }

  async function onConfirmMerge() {
    setBusy(true);
    setError("");
    setStatus("Mesclando…");
    setResultUrl(null);
    try {
      const result = await mergeMarkedCandidates({
        candidateIds: orderedIds,
        quality,
      });
      setResultUrl(
        apiUrl(`/media/${result.vodId}/${result.prontosRelativePath}`)
      );
      setStatus(
        `Merge ok (${(result.elapsedMs / 1000).toFixed(1)}s)` +
          (result.normalized
            ? ` · normalizado para ${result.targetResolution.w}×${result.targetResolution.h}`
            : " · sem normalizar") +
          ` → ${result.prontosRelativePath}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        Reordene com ↑ / ↓ e confirme o merge. Só candidatos{" "}
        <code className="text-zinc-300">exported</code>.
      </p>

      {loading && <p className="text-sm text-zinc-500">Carregando…</p>}

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

      <label className="block text-sm">
        Qualidade do merge
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as QualityId)}
          className="mt-1 block rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
        >
          <option value="draft">draft</option>
          <option value="hd">hd</option>
          <option value="max">max</option>
        </select>
      </label>

      <ol className="space-y-2">
        {orderedIds.map((id, index) => {
          const c = byId[id];
          return (
            <li
              key={id}
              className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/60 p-2"
            >
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  aria-label="Mover para cima"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-sm hover:bg-zinc-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Mover para baixo"
                  disabled={index === orderedIds.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-sm hover:bg-zinc-700 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={candidateThumbnailUrl(id)}
                alt=""
                width={96}
                height={54}
                className="h-[54px] w-[96px] rounded bg-zinc-800 object-cover"
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate text-zinc-200">
                  {c?.reason || id}
                </div>
                <div className="text-xs text-zinc-500">
                  #{index + 1} · {c?.status ?? "?"} · {id.slice(0, 8)}…
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        disabled={
          busy ||
          orderedIds.length < 2 ||
          !!error ||
          orderedIds.some((id) => byId[id]?.status !== "exported")
        }
        onClick={onConfirmMerge}
        className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-medium hover:bg-fuchsia-600 disabled:opacity-50"
      >
        {busy ? "Mesclando…" : "Confirmar merge"}
      </button>

      {resultUrl && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <a
            href={resultUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-sky-400 hover:underline"
          >
            Abrir merged.mp4
          </a>
          <video
            src={resultUrl}
            controls
            className="w-full max-h-72 rounded bg-black"
          />
        </div>
      )}
    </div>
  );
}

export default function MarkedMergePage({ params }: Props) {
  const [vodId, setVodId] = useState("");

  useEffect(() => {
    params.then((p) => setVodId(p.vodId));
  }, [params]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <main className="mx-auto max-w-xl space-y-4">
        <Link
          href={`/vod/${vodId}/marked`}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← Voltar à lista
        </Link>
        <h1 className="text-2xl font-semibold">Juntar clipes</h1>
        {vodId ? (
          <Suspense
            fallback={<p className="text-sm text-zinc-500">Carregando…</p>}
          >
            <MergeInner vodId={vodId} />
          </Suspense>
        ) : null}
      </main>
    </div>
  );
}
