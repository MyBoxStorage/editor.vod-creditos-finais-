"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchComposition, type CompositionWithSegments } from "../../../../../lib/api";
import { FinalizationEditor } from "./FinalizationEditor";

type Props = {
  params: Promise<{ vodId: string; compositionId: string }>;
};

export default function FinalizacaoEditorPage({ params }: Props) {
  const [vodId, setVodId] = useState("");
  const [compositionId, setCompositionId] = useState("");
  const [composition, setComposition] = useState<CompositionWithSegments | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then((p) => {
      setVodId(p.vodId);
      setCompositionId(p.compositionId);
    });
  }, [params]);

  useEffect(() => {
    if (!compositionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const comp = await fetchComposition(compositionId);
        if (!cancelled) setComposition(comp);
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
  }, [compositionId]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
          <Link
            href={`/vod/${vodId}/finalizacao`}
            className="hover:text-zinc-200"
          >
            ← Composições
          </Link>
          <span>·</span>
          <span className="text-zinc-300">
            {composition?.name || compositionId.slice(0, 8)}
          </span>
        </div>
      </header>

      {loading && (
        <p className="p-6 text-sm text-zinc-500">Carregando composição…</p>
      )}
      {error && (
        <p className="m-6 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {!loading && !error && composition && vodId && (
        <FinalizationEditor
          vodId={vodId}
          composition={composition}
          onCompositionChange={setComposition}
        />
      )}
    </div>
  );
}
