"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchVods, type VodListItem } from "../lib/api";

function formatDuration(sec: number | null): string {
  if (sec == null || !(sec > 0)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s}s`;
}

function formatUploadDate(raw: string | null): string {
  if (!raw || raw.length !== 8) return raw || "—";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export default function Home() {
  const [vods, setVods] = useState<VodListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchVods();
        if (!cancelled) setVods(list);
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
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <main className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Twitch Clip Editor</h1>
          <p className="mt-1 text-sm text-zinc-400">
            VODs já processados em <code className="text-zinc-300">backend/data</code>
          </p>
          <p className="mt-2">
            <Link
              href="/biblioteca"
              className="text-sm text-amber-300/90 underline hover:text-amber-200"
            >
              Biblioteca de efeitos
            </Link>
          </p>
        </header>

        {error && (
          <p className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-zinc-500">Carregando VODs…</p>}

        {!loading && vods.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nenhum VOD com meta.json encontrado. Rode o ingest primeiro.
          </p>
        )}

        <ul className="space-y-2">
          {vods.map((v) => (
            <li key={v.vodId}>
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="font-medium">{v.title}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>{v.vodId}</span>
                  <span>{formatDuration(v.duration)}</span>
                  <span>{formatUploadDate(v.uploadDate)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <Link
                    href={`/vod/${v.vodId}/marked`}
                    className="rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 hover:border-zinc-400"
                  >
                    Candidatos marcados
                  </Link>
                  <Link
                    href={`/vod/${v.vodId}/segments`}
                    className="rounded border border-sky-800 bg-sky-950/40 px-3 py-1.5 text-sky-200 hover:border-sky-600"
                  >
                    Gaveta de edição
                  </Link>
                  <Link
                    href={`/vod/${v.vodId}`}
                    className="rounded border border-zinc-800 px-3 py-1.5 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  >
                    Editor legado
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
