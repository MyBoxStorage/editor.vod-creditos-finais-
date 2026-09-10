"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createComposition,
  fetchClipSegments,
  fetchCompositions,
  type ClipSegment,
  type Composition,
} from "../../../../lib/api";
import {
  formatClipTime,
  durationWarningLevel,
} from "../../../../lib/finalizationTime";

type Props = {
  params: Promise<{ vodId: string }>;
};

function segmentDuration(s: ClipSegment): number {
  return Math.max(0.1, s.sourceEnd - s.sourceStart);
}

export default function FinalizacaoListPage({ params }: Props) {
  const [vodId, setVodId] = useState("");
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
        const [comps, segs] = await Promise.all([
          fetchCompositions(vodId),
          fetchClipSegments(vodId),
        ]);
        if (!cancelled) {
          setCompositions(comps);
          setSegments(segs.clipSegments ?? []);
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
  }, [vodId]);

  function toggleSegment(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onCreateComposition() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const ordered = segments
        .filter((s) => ids.includes(s.id))
        .sort((a, b) => a.sourceStart - b.sourceStart)
        .map((s) => s.id);
      const comp = await createComposition({ vodId, clipSegmentIds: ordered });
      window.location.href = `/vod/${vodId}/finalizacao/${comp.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const selectedDuration = segments
    .filter((s) => selectedIds.has(s.id))
    .reduce((sum, s) => sum + segmentDuration(s), 0);
  const warnLevel = durationWarningLevel(selectedDuration);

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
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
            <Link href={`/vod/${vodId}/segments`} className="hover:text-zinc-200">
              Gaveta
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">Edição final</h1>
          <p className="text-sm text-zinc-400">
            Composições da camada 3 — monte sequências a partir dos trechos da
            gaveta.
          </p>
        </header>

        {error && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-zinc-500">Carregando…</p>}

        {!loading && (
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-medium">Composições</h2>
              {compositions.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Nenhuma composição ainda. Crie uma abaixo.
                </p>
              ) : (
                <ul className="space-y-2">
                  {compositions.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/vod/${vodId}/finalizacao/${c.id}`}
                        className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:border-zinc-600"
                      >
                        <div>
                          <div className="text-sm text-zinc-200">
                            {c.name || `Composição ${c.id.slice(0, 8)}…`}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {c.status} · {new Date(c.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span className="text-xs text-sky-400">abrir →</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3 border-t border-zinc-800 pt-6">
              <h2 className="text-lg font-medium">Nova composição</h2>
              <p className="text-sm text-zinc-400">
                Selecione trechos da gaveta para montar uma sequência.
              </p>

              {segments.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Nenhum trecho na gaveta.{" "}
                  <Link
                    href={`/vod/${vodId}/segments`}
                    className="text-sky-400 hover:underline"
                  >
                    Abrir gaveta
                  </Link>
                </p>
              ) : (
                <>
                  <ul className="max-h-72 space-y-1 overflow-y-auto rounded border border-zinc-800 p-2">
                    {segments.map((s) => {
                      const dur = segmentDuration(s);
                      const checked = selectedIds.has(s.id);
                      return (
                        <li key={s.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-zinc-900/80">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSegment(s.id)}
                              className="rounded"
                            />
                            <span className="min-w-0 flex-1 text-sm text-zinc-200">
                              {s.role === "hook" && (
                                <span className="mr-1 text-fuchsia-400">
                                  [gancho]
                                </span>
                              )}
                              {formatClipTime(s.sourceStart)} –{" "}
                              {formatClipTime(s.sourceEnd)}
                              <span className="ml-2 text-xs text-zinc-500">
                                ({formatClipTime(dur)})
                              </span>
                            </span>
                            <span className="text-xs text-zinc-500">
                              {s.status}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>

                  {selectedIds.size > 0 && (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-zinc-400">
                        {selectedIds.size} trecho(s) ·{" "}
                        {formatClipTime(selectedDuration)}
                      </span>
                      {warnLevel === "soft" && (
                        <span className="text-amber-300">acima de 22s</span>
                      )}
                      {warnLevel === "strong" && (
                        <span className="text-red-300">acima de 30s</span>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={busy || selectedIds.size === 0}
                    onClick={onCreateComposition}
                    className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-medium hover:bg-fuchsia-600 disabled:opacity-50"
                  >
                    {busy ? "Criando…" : "Criar composição"}
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
