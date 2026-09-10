import Link from "next/link";
import type { ClipSegment, MarkedCandidate } from "../../../../../../lib/api";
import type { EditKind } from "../types";
import { formatTime } from "../utils";

type EditorHeaderProps = {
  vodId: string;
  candidateId: string;
  editKind: EditKind | null;
  candidate: MarkedCandidate | null;
  clipSegmentMeta: ClipSegment | null;
  isIsolated: boolean;
  clipDuration: number;
  trechoStart: number;
  trechoEnd: number;
  siblingSegmentIds: string[];
  siblingIndex: number;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
  trimming: boolean;
  router: { push: (href: string) => void };
  onHelpClick: () => void;
};

export function EditorHeader({
  vodId,
  candidateId,
  editKind,
  candidate,
  clipSegmentMeta,
  isIsolated,
  clipDuration,
  trechoStart,
  trechoEnd,
  siblingSegmentIds,
  siblingIndex,
  prevSiblingId,
  nextSiblingId,
  trimming,
  router,
  onHelpClick,
}: EditorHeaderProps) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="relative flex-1">
        <Link
          href={
            editKind === "clip_segment"
              ? `/vod/${vodId}/segments`
              : `/vod/${vodId}/marked`
          }
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          {editKind === "clip_segment"
            ? "← Gaveta de edição"
            : "← Candidatos marcados"}
        </Link>
        {vodId && editKind !== "clip_segment" && (
          <Link
            href={`/vod/${vodId}/segments`}
            className="ml-3 text-sm text-sky-400 hover:text-sky-300"
          >
            Gaveta de edição
          </Link>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Editor do clipe</h1>
          {editKind === "clip_segment" && (
            <span className="rounded border border-sky-700 bg-sky-950/50 px-2 py-0.5 text-xs text-sky-200">
              Trecho de edição
            </span>
          )}
          {editKind === "candidate" && (
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300">
              do VOD
            </span>
          )}
          {clipSegmentMeta?.role === "hook" && (
            <span className="rounded border border-fuchsia-600 bg-fuchsia-900/60 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-fuchsia-100">
              Gancho
            </span>
          )}
          {clipSegmentMeta?.isReusable && (
            <span className="rounded border border-teal-700 bg-teal-950/50 px-2 py-0.5 text-xs text-teal-200">
              Reutilizável
              {clipSegmentMeta.reusableName
                ? `: ${clipSegmentMeta.reusableName}`
                : ""}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          {candidateId}
          {candidate ? ` · ${candidate.status}` : ""}
        </p>
        {editKind === "candidate" && (
          <p className="text-xs text-zinc-400">
            tempo do VOD: {formatTime(trechoStart)}–{formatTime(trechoEnd)}
          </p>
        )}
        {isIsolated && (
          <p className="mt-2 rounded border border-sky-900/70 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
            Editando trecho isolado ({clipDuration.toFixed(1)}s) — player e
            timeline usam só o preview cortado, não o VOD inteiro.
          </p>
        )}
        {isIsolated && siblingSegmentIds.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              disabled={!prevSiblingId}
              onClick={() => {
                if (!prevSiblingId || !vodId) return;
                router.push(`/vod/${vodId}/marked/${prevSiblingId}`);
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
            >
              ← Trecho anterior
            </button>
            <button
              type="button"
              disabled={!nextSiblingId}
              onClick={() => {
                if (!nextSiblingId || !vodId) return;
                router.push(`/vod/${vodId}/marked/${nextSiblingId}`);
              }}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
            >
              Próximo trecho →
            </button>
            <span className="self-center text-xs text-zinc-500">
              {siblingIndex + 1}/{siblingSegmentIds.length}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {trimming && (
          <span className="text-xs text-amber-300">Preparando trecho…</span>
        )}
        <button
          type="button"
          onClick={onHelpClick}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          aria-label="Ajuda e atalhos"
          title="Ajuda"
        >
          ?
        </button>
      </div>
    </header>
  );
}
