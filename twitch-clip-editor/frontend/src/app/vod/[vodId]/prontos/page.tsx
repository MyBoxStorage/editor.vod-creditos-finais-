"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  apiUrl,
  fetchProntosRuns,
  type ProntosRun,
} from "../../../../lib/api";

type Props = {
  params: Promise<{ vodId: string }>;
};

export default function ProntosDebugPage({ params }: Props) {
  const [vodId, setVodId] = useState("");
  const [runs, setRuns] = useState<ProntosRun[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    params.then((p) => setVodId(p.vodId));
  }, [params]);

  useEffect(() => {
    if (!vodId) return;
    fetchProntosRuns(vodId)
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [vodId]);

  if (!vodId) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-lg font-medium text-zinc-300">
            Arquivos em prontos/ — {vodId}
          </h1>
          <Link
            href={`/vod/${vodId}`}
            className="text-sm text-sky-400 hover:text-sky-300"
          >
            ← VOD completo
          </Link>
        </header>
        <p className="text-xs text-zinc-500">
          Página de depuração. Não faz parte do fluxo principal de edição.
        </p>
        {error && <p className="text-sm text-red-300">{error}</p>}
        {runs.length === 0 && !error && (
          <p className="text-sm text-zinc-500">Nenhuma rodada em prontos/.</p>
        )}
        <ul className="space-y-3">
          {runs.map((run) => (
            <li
              key={run.runId}
              className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
            >
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="font-mono text-xs">{run.runId}</span>
                <span className="text-xs text-zinc-500">
                  {run.labelDate ?? "—"}
                  {run.method ? ` · ${run.method}` : ""} · {run.clipCount} clipe
                  {run.clipCount === 1 ? "" : "s"}
                </span>
              </div>
              {run.clips.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {run.clips.map((c) => (
                    <li key={c.fileName} className="text-xs">
                      <a
                        href={apiUrl(c.urlPath)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:underline"
                      >
                        {c.fileName}
                      </a>
                      <span className="ml-2 text-zinc-600">
                        {(c.sizeBytes / 1_000_000).toFixed(1)} MB
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
