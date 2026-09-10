"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LibraryBrowser } from "../../../../../../components/library/LibraryBrowser";
import { LibraryPreviewProvider } from "../../../../../../components/library/useLibraryPreview";
import {
  applyEffectToClip,
  fetchClipEffects,
  fetchEffectLibraryItem,
  removeEffectFromClip,
  type ClipEffectInstance,
  type EffectLibraryCard,
  type EffectLibraryItem,
  type EffectLibraryType,
} from "../../../../../../lib/api";
import { formatTime } from "../utils";
import { onTimeFieldBlur, onTimeFieldChange } from "../timeField";
import { SectionFeedback } from "./SectionFeedback";
import { useOverlayEdit } from "../overlayEditContext";
import {
  maxNativeWidthPercent,
  normalizeVisualFades,
} from "../../../../../../lib/overlayFade";
import {
  BACKGROUND_REMOVAL_LABELS,
  parseBackgroundRemovalMode,
} from "../../../../../../lib/backgroundRemoval";

type Props = {
  candidateId: string;
  clipDuration: number;
  getPlayheadTime: () => number;
  disabled?: boolean;
  appliedEffects: ClipEffectInstance[];
  onAppliedEffectsChange: (effects: ClipEffectInstance[]) => void;
  onBeforeApply?: () => void;
  onBeforeRemove?: () => void;
  onStatus?: (msg: string) => void;
  onError?: (msg: string) => void;
  status?: string;
  error?: string;
};

function typeLabel(t: EffectLibraryType): string {
  switch (t) {
    case "video":
      return "Vídeo";
    case "image":
      return "Imagem";
    case "music":
      return "Música";
    case "sfx":
      return "SFX";
  }
}

function ScissorsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function LibraryEffectsPanel({
  candidateId,
  clipDuration,
  getPlayheadTime,
  disabled = false,
  appliedEffects,
  onAppliedEffectsChange,
  onBeforeApply,
  onBeforeRemove,
  onStatus,
  onError,
  status,
  error,
}: Props) {
  const { draft, setDraft, resetDraft } = useOverlayEdit();
  const [selected, setSelected] = useState<EffectLibraryItem | null>(null);
  const applied = appliedEffects;
  const [effectsLoading, setEffectsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const [sourceTrimStart, setSourceTrimStart] = useState(0);
  const [sourceTrimEnd, setSourceTrimEnd] = useState(2);
  const [clipTimestamp, setClipTimestamp] = useState(0);

  const [trimStartInput, setTrimStartInput] = useState("0:00,0");
  const [trimEndInput, setTrimEndInput] = useState("0:02,0");
  const [clipTimestampInput, setClipTimestampInput] = useState("0:00,0");
  const [trimStartError, setTrimStartError] = useState(false);
  const [trimEndError, setTrimEndError] = useState(false);
  const [clipTimestampError, setClipTimestampError] = useState(false);

  const sourceBarRef = useRef<HTMLDivElement>(null);
  const clipBarRef = useRef<HTMLDivElement>(null);
  const draggingSource = useRef<"start" | "end" | null>(null);
  const draggingClip = useRef(false);
  const clipTimestampTouched = useRef(false);

  const [volume, setVolume] = useState(1);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [duckingEnabled, setDuckingEnabled] = useState(false);
  const [videoLoopEnabled, setVideoLoopEnabled] = useState(false);

  const onAppliedEffectsChangeRef = useRef(onAppliedEffectsChange);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onAppliedEffectsChangeRef.current = onAppliedEffectsChange;
    onErrorRef.current = onError;
  });

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const fileDuration = useMemo(() => {
    if (selected?.type === "image") {
      return Math.max(sourceTrimEnd, 10);
    }
    const d = selected?.durationSeconds;
    if (d != null && Number.isFinite(d) && d > 0) return d;
    return Math.max(sourceTrimEnd, 2);
  }, [selected, sourceTrimEnd]);

  const effectPartDuration = Math.max(0, sourceTrimEnd - sourceTrimStart);

  const reloadEffects = useCallback(async () => {
    if (!candidateId) return;
    setEffectsLoading(true);
    try {
      const effects = await fetchClipEffects(candidateId);
      onAppliedEffectsChangeRef.current(effects);
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : String(e));
    } finally {
      setEffectsLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void reloadEffects();
  }, [reloadEffects]);

  const onSelectCard = useCallback(
    async (card: EffectLibraryCard) => {
      setSelectedId(card.id);
      try {
        const full = await fetchEffectLibraryItem(card.id);
        if (selectedIdRef.current === card.id) {
          setSelected(full);
        }
      } catch (e) {
        onErrorRef.current?.(e instanceof Error ? e.message : String(e));
      }
    },
    []
  );

  useEffect(() => {
    if (!selected) {
      resetDraft();
      return;
    }
    const defaultDur =
      selected.type === "image" ? 2 : (selected.durationSeconds ?? 2);
    setSourceTrimStart(0);
    setSourceTrimEnd(Number(defaultDur.toFixed(2)));
    setClipTimestamp(0);
    clipTimestampTouched.current = false;
    setTrimStartInput(formatTime(0));
    setTrimEndInput(formatTime(Number(defaultDur.toFixed(2))));
    setClipTimestampInput(formatTime(0));
    if (selected.type === "video" || selected.type === "image") {
      const nativeW = selected.imageWidth;
      const defaultWidth =
        selected.type === "image" && nativeW != null && nativeW > 0
          ? Math.min(40, maxNativeWidthPercent(nativeW))
          : selected.type === "image"
            ? 40
            : 100;
      setDraft({
        active: true,
        mediaType: selected.type,
        name: selected.name,
        src: selected.filePath,
        positionX: selected.type === "image" ? 10 : 0,
        positionY: selected.type === "image" ? 10 : 0,
        positionWidth: defaultWidth,
        positionHeight: selected.type === "image" ? defaultWidth : 100,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        clipTimestamp: 0,
        overlayDuration: Number(defaultDur.toFixed(2)),
        imageNativeWidth: selected.imageWidth,
        aspectLocked: true,
      });
    } else {
      resetDraft();
      setVolume(1);
      setFadeInSeconds(0);
      setFadeOutSeconds(0);
      setDuckingEnabled(false);
      setVideoLoopEnabled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (!draft.active) return;
    setDraft({
      clipTimestamp,
      overlayDuration: effectPartDuration,
    });
  }, [clipTimestamp, effectPartDuration, draft.active, setDraft]);

  function timeFromSourceBar(clientX: number): number {
    const el = sourceBarRef.current;
    if (!el || fileDuration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * fileDuration).toFixed(3));
  }

  function timeFromClipBar(clientX: number): number {
    const el = clipBarRef.current;
    if (!el || clipDuration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * clipDuration).toFixed(3));
  }

  function onSourcePointerDown(
    which: "start" | "end",
    e: React.PointerEvent<HTMLButtonElement>
  ) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingSource.current = which;
  }

  function onSourcePointerMove(e: React.PointerEvent<HTMLElement>) {
    const which = draggingSource.current;
    if (!which) return;
    const t = timeFromSourceBar(e.clientX);
    if (which === "start") {
      const next = Math.max(0, Math.min(t, sourceTrimEnd - 0.1));
      setSourceTrimStart(next);
      setTrimStartInput(formatTime(next));
    } else {
      const next = Math.min(fileDuration, Math.max(t, sourceTrimStart + 0.1));
      setSourceTrimEnd(next);
      setTrimEndInput(formatTime(next));
    }
  }

  function onSourcePointerUp() {
    draggingSource.current = null;
  }

  function onClipBarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingClip.current = true;
    clipTimestampTouched.current = true;
    const t = timeFromClipBar(e.clientX);
    const maxStart = Math.max(0, clipDuration - effectPartDuration);
    const clamped = Number(Math.max(0, Math.min(t, maxStart)).toFixed(3));
    setClipTimestamp(clamped);
    setClipTimestampInput(formatTime(clamped));
  }

  function onClipBarPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!draggingClip.current) return;
    const t = timeFromClipBar(e.clientX);
    const maxStart = Math.max(0, clipDuration - effectPartDuration);
    const clamped = Number(Math.max(0, Math.min(t, maxStart)).toFixed(3));
    setClipTimestamp(clamped);
    setClipTimestampInput(formatTime(clamped));
  }

  function onClipBarPointerUp() {
    draggingClip.current = false;
  }

  async function onApply() {
    if (!selected || !candidateId) return;
    onBeforeApply?.();
    setBusy(true);
    try {
      const entryTime = clipTimestampTouched.current
        ? clipTimestamp
        : getPlayheadTime();
      const maxStart = Math.max(0, clipDuration - effectPartDuration);
      const clampedEntry = Number(
        Math.max(0, Math.min(entryTime, maxStart)).toFixed(3)
      );
      if (!clipTimestampTouched.current) {
        setClipTimestamp(clampedEntry);
        setClipTimestampInput(formatTime(clampedEntry));
      }
      const body: Parameters<typeof applyEffectToClip>[1] = {
        effectLibraryItemId: selected.id,
        sourceTrimStart,
        sourceTrimEnd,
        clipTimestamp: clampedEntry,
      };
      if (selected.type === "video" || selected.type === "image") {
        const { fadeIn, fadeOut, adjusted } = normalizeVisualFades(
          effectPartDuration,
          draft.fadeInSeconds,
          draft.fadeOutSeconds
        );
        body.positionX = draft.positionX;
        body.positionY = draft.positionY;
        body.positionWidth = draft.positionWidth;
        body.positionHeight = draft.positionHeight;
        body.fadeInSeconds = fadeIn;
        body.fadeOutSeconds = fadeOut;
        if (selected.type === "video") {
          body.videoLoopEnabled = videoLoopEnabled;
        }
        if (adjusted) {
          onStatus?.(
            `Fades ajustados proporcionalmente (soma > duração ${effectPartDuration.toFixed(1)}s).`
          );
        }
      } else {
        body.volume = volume;
        if (selected.type === "music") {
          body.fadeInSeconds = fadeInSeconds;
          body.fadeOutSeconds = fadeOutSeconds;
          body.duckingEnabled = duckingEnabled;
        }
      }
      const effect = await applyEffectToClip(candidateId, body);
      onAppliedEffectsChangeRef.current([...applied, effect]);
      onStatus?.(
        `Efeito “${selected.name}” aplicado em ${formatTime(clampedEntry)}`
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(instanceId: string) {
    onBeforeRemove?.();
    setBusy(true);
    try {
      await removeEffectFromClip(candidateId, instanceId);
      onAppliedEffectsChangeRef.current(
        applied.filter((e) => e.id !== instanceId)
      );
      onStatus?.("Efeito removido do clipe.");
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sourceStartPct =
    fileDuration > 0 ? (sourceTrimStart / fileDuration) * 100 : 0;
  const sourceEndPct =
    fileDuration > 0 ? (sourceTrimEnd / fileDuration) * 100 : 100;
  const sourceWidthPct = Math.max(sourceEndPct - sourceStartPct, 0.5);

  const clipMarkerPct =
    clipDuration > 0 ? (clipTimestamp / clipDuration) * 100 : 0;
  const clipBlockWidthPct =
    clipDuration > 0
      ? Math.max((effectPartDuration / clipDuration) * 100, 0.5)
      : 0;

  return (
    <div className="space-y-3 rounded border border-lime-900/50 bg-lime-950/15 p-4">
      <SectionFeedback status={status} error={error} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-lime-100">
            efeitos da biblioteca
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Overlay / música / SFX manuais — independentes dos presets de
            momento. Validação via export.
          </p>
        </div>
        <Link
          href="/biblioteca"
          className="text-xs text-lime-300/80 underline hover:text-lime-200"
        >
          Abrir biblioteca
        </Link>
      </div>

      {effectsLoading ? (
        <p className="text-xs text-zinc-500">Carregando efeitos aplicados…</p>
      ) : (
        <LibraryPreviewProvider>
          <div className="space-y-3">
            <LibraryBrowser
              density="compact"
              mode="pick"
              selectedId={selectedId}
              disabled={disabled || busy}
              gridHeightClass="h-[280px]"
              showSections={false}
              onSelect={(item) => void onSelectCard(item)}
            />

            {/* BLOCO 1 — parte do efeito */}
          {!selected && selectedId ? (
            <p className="text-xs text-zinc-500">Carregando item…</p>
          ) : selected?.type === "image" ? (
            <div
              className="space-y-2 rounded-lg p-3"
              style={{
                background: "var(--bg-accent)",
                color: "var(--text-accent)",
              }}
            >
              <div className="flex items-center gap-2 text-sm">
                <ScissorsIcon />
                <span className="font-medium">duração na tela</span>
              </div>
              <label className="text-xs">
                segundos visíveis
                <input
                  type="number"
                  min={0.1}
                  max={30}
                  step={0.1}
                  value={effectPartDuration}
                  onChange={(e) => {
                    const next = Math.max(0.1, Number(e.target.value));
                    setSourceTrimStart(0);
                    setSourceTrimEnd(next);
                    setTrimEndInput(formatTime(next));
                  }}
                  disabled={disabled || busy}
                  className="mt-1 block w-24 rounded border border-sky-800/60 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              {selected.imageWidth != null && selected.imageWidth > 0 && (
                <p className="text-[11px] opacity-90">
                  Largura nativa {selected.imageWidth}px — ocupa até{" "}
                  {maxNativeWidthPercent(selected.imageWidth).toFixed(0)}% do
                  frame sem perder qualidade.
                </p>
              )}
              {/\.(jpe?g)$/i.test(selected.filePath) && (
                <p className="text-[11px] text-amber-200/90">
                  JPG sem transparência — o overlay ficará com fundo.
                </p>
              )}
            </div>
          ) : selected ? (
          <div
            className="space-y-2 rounded-lg p-3"
            style={{
              background: "var(--bg-accent)",
              color: "var(--text-accent)",
            }}
          >
            <div className="flex items-center gap-2 text-sm">
              <ScissorsIcon />
              <span className="font-medium">parte do efeito</span>
              <span className="font-normal opacity-90">
                qual pedaço do arquivo
              </span>
            </div>
            <div
              ref={sourceBarRef}
              className="relative h-10 w-full max-w-full touch-none rounded border border-sky-800/60 bg-sky-950/40"
              onPointerMove={onSourcePointerMove}
              onPointerUp={onSourcePointerUp}
              onPointerCancel={onSourcePointerUp}
            >
              <div
                className="pointer-events-none absolute top-1 bottom-1 rounded bg-sky-500/60"
                style={{
                  left: `${sourceStartPct}%`,
                  width: `${sourceWidthPct}%`,
                }}
              />
              <button
                type="button"
                aria-label="início da parte do efeito"
                disabled={disabled || busy}
                onPointerDown={(e) => onSourcePointerDown("start", e)}
                onPointerMove={onSourcePointerMove}
                onPointerUp={onSourcePointerUp}
                onPointerCancel={onSourcePointerUp}
                className="absolute top-0 z-10 h-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white"
                style={{ left: `${sourceStartPct}%` }}
              />
              <button
                type="button"
                aria-label="fim da parte do efeito"
                disabled={disabled || busy}
                onPointerDown={(e) => onSourcePointerDown("end", e)}
                onPointerMove={onSourcePointerMove}
                onPointerUp={onSourcePointerUp}
                onPointerCancel={onSourcePointerUp}
                className="absolute top-0 z-10 h-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white"
                style={{ left: `${sourceEndPct}%` }}
              />
            </div>
            <p className="text-xs">
              {formatTime(sourceTrimStart)} → {formatTime(sourceTrimEnd)} do
              arquivo
            </p>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs">
                início
                <input
                  type="text"
                  inputMode="text"
                  value={trimStartInput}
                  onChange={(e) =>
                    onTimeFieldChange(
                      e.target.value,
                      setTrimStartInput,
                      setTrimStartError,
                      (next) => {
                        const clamped = Math.max(
                          0,
                          Math.min(Number(next.toFixed(3)), sourceTrimEnd - 0.1)
                        );
                        setSourceTrimStart(clamped);
                      }
                    )
                  }
                  onBlur={() =>
                    onTimeFieldBlur(
                      trimStartInput,
                      sourceTrimStart,
                      setTrimStartInput,
                      setTrimStartError
                    )
                  }
                  disabled={disabled || busy}
                  className="mt-1 block w-28 rounded border border-sky-800/60 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100"
                />
                {trimStartError && (
                  <span className="ml-1 text-red-300">hora inválida</span>
                )}
              </label>
              <label className="text-xs">
                fim
                <input
                  type="text"
                  inputMode="text"
                  value={trimEndInput}
                  onChange={(e) =>
                    onTimeFieldChange(
                      e.target.value,
                      setTrimEndInput,
                      setTrimEndError,
                      (next) => {
                        const clamped = Math.min(
                          fileDuration,
                          Math.max(Number(next.toFixed(3)), sourceTrimStart + 0.1)
                        );
                        setSourceTrimEnd(clamped);
                      }
                    )
                  }
                  onBlur={() =>
                    onTimeFieldBlur(
                      trimEndInput,
                      sourceTrimEnd,
                      setTrimEndInput,
                      setTrimEndError
                    )
                  }
                  disabled={disabled || busy}
                  className="mt-1 block w-28 rounded border border-sky-800/60 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100"
                />
                {trimEndError && (
                  <span className="ml-1 text-red-300">hora inválida</span>
                )}
              </label>
            </div>
            {selected.type === "video" && (
              <div className="space-y-2 border-t border-sky-800/40 pt-2">
                <p className="text-xs opacity-90">
                  remoção de fundo ativa:{" "}
                  <strong>
                    {
                      BACKGROUND_REMOVAL_LABELS[
                        parseBackgroundRemovalMode(
                          selected.backgroundRemovalMode
                        )
                      ]
                    }
                  </strong>
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={videoLoopEnabled}
                    onChange={(e) => setVideoLoopEnabled(e.target.checked)}
                    disabled={disabled || busy}
                  />
                  repetir trecho até o fim do clipe
                </label>
              </div>
            )}
          </div>
          ) : null}

          {/* BLOCO 2 — momento do clipe */}
          {selected && (
          <>
          <div
            className="space-y-2 rounded-lg p-3"
            style={{
              background: "var(--bg-warning)",
              color: "var(--text-warning)",
            }}
          >
            <div className="flex items-center gap-2 text-sm">
              <MapPinIcon />
              <span className="font-medium">momento do clipe</span>
              <span className="font-normal opacity-90">onde ele entra</span>
            </div>
            <div
              ref={clipBarRef}
              className="relative h-10 w-[68%] max-w-md touch-none rounded border border-amber-800/60 bg-amber-950/40"
              onPointerDown={onClipBarPointerDown}
              onPointerMove={onClipBarPointerMove}
              onPointerUp={onClipBarPointerUp}
              onPointerCancel={onClipBarPointerUp}
            >
              <div
                className="pointer-events-none absolute top-2 bottom-2 rounded border border-amber-400/80 bg-amber-500/50"
                style={{
                  left: `${clipMarkerPct}%`,
                  width: `${clipBlockWidthPct}%`,
                }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-amber-200"
                style={{ left: `${clipMarkerPct}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs">
                entra em {formatTime(clipTimestamp)}
              </p>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => {
                  clipTimestampTouched.current = true;
                  const t = getPlayheadTime();
                  const maxStart = Math.max(0, clipDuration - effectPartDuration);
                  const clamped = Number(
                    Math.max(0, Math.min(t, maxStart)).toFixed(3)
                  );
                  setClipTimestamp(clamped);
                  setClipTimestampInput(formatTime(clamped));
                }}
                className="rounded border border-amber-700/80 px-2 py-0.5 text-xs hover:border-amber-500"
              >
                = playhead
              </button>
            </div>
            <label className="text-xs">
              entrada
              <input
                type="text"
                inputMode="text"
                value={clipTimestampInput}
                onChange={(e) => {
                  clipTimestampTouched.current = true;
                  onTimeFieldChange(
                    e.target.value,
                    setClipTimestampInput,
                    setClipTimestampError,
                    (next) => {
                      const maxStart = Math.max(
                        0,
                        clipDuration - effectPartDuration
                      );
                      const clamped = Number(
                        Math.max(0, Math.min(next, maxStart)).toFixed(3)
                      );
                      setClipTimestamp(clamped);
                    }
                  );
                }}
                onBlur={() =>
                  onTimeFieldBlur(
                    clipTimestampInput,
                    clipTimestamp,
                    setClipTimestampInput,
                    setClipTimestampError
                  )
                }
                disabled={disabled || busy}
                className="mt-1 block w-28 rounded border border-amber-800/60 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100"
              />
              {clipTimestampError && (
                <span className="ml-1 text-red-300">hora inválida</span>
              )}
            </label>
          </div>

          {(selected?.type === "video" || selected?.type === "image") && (
            <div className="flex flex-wrap gap-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
              <p className="w-full text-[11px] text-zinc-500">
                Posição do overlay (% do frame) — arraste no preview ou ajuste
                fino aqui
              </p>
              {(
                [
                  ["X", draft.positionX, (v: number) => setDraft({ positionX: v })],
                  ["Y", draft.positionY, (v: number) => setDraft({ positionY: v })],
                  [
                    "Largura",
                    draft.positionWidth,
                    (v: number) => setDraft({ positionWidth: v }),
                  ],
                  [
                    "Altura",
                    draft.positionHeight,
                    (v: number) => setDraft({ positionHeight: v }),
                  ],
                ] as const
              ).map(([label, val, setVal]) => (
                <label key={label} className="text-xs text-zinc-400">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={val}
                    onChange={(e) => setVal(Number(e.target.value))}
                    disabled={disabled || busy}
                    className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                  />
                </label>
              ))}
              <label className="text-xs text-zinc-400">
                Fade in (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={draft.fadeInSeconds}
                  onChange={(e) =>
                    setDraft({ fadeInSeconds: Math.max(0, Number(e.target.value)) })
                  }
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Fade out (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={draft.fadeOutSeconds}
                  onChange={(e) =>
                    setDraft({ fadeOutSeconds: Math.max(0, Number(e.target.value)) })
                  }
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              {draft.fadeInSeconds + draft.fadeOutSeconds > effectPartDuration &&
                effectPartDuration > 0 && (
                  <p className="w-full text-[11px] text-amber-200/90">
                    Fade in + fade out excedem a duração — serão encurtados
                    proporcionalmente ao aplicar.
                  </p>
                )}
            </div>
          )}

          {selected?.type === "music" && (
            <div className="flex flex-wrap items-end gap-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
              <label className="text-xs text-zinc-400">
                Volume
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Fade in (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={fadeInSeconds}
                  onChange={(e) => setFadeInSeconds(Number(e.target.value))}
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Fade out (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={fadeOutSeconds}
                  onChange={(e) => setFadeOutSeconds(Number(e.target.value))}
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300 pb-1">
                <input
                  type="checkbox"
                  checked={duckingEnabled}
                  onChange={(e) => setDuckingEnabled(e.target.checked)}
                  disabled={disabled || busy}
                />
                Ducking (abaixa áudio do clipe)
              </label>
            </div>
          )}

          {selected?.type === "sfx" && (
            <div className="flex flex-wrap gap-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
              <label className="text-xs text-zinc-400">
                Volume
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  disabled={disabled || busy}
                  className="mt-1 block w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
                />
              </label>
              <p className="self-end pb-1 text-[11px] text-zinc-500">
                Você pode aplicar o mesmo SFX várias vezes em momentos
                diferentes.
              </p>
            </div>
          )}

          <button
            type="button"
            disabled={disabled || busy || !selected}
            onClick={() => void onApply()}
            className="rounded border border-lime-700 bg-lime-950/60 px-3 py-1.5 text-sm text-lime-100 hover:bg-lime-900/70 disabled:opacity-50"
          >
            {busy ? "Aplicando…" : "aplicar"}
          </button>
          </>
          )}
          </div>
        </LibraryPreviewProvider>
      )}

      <div className="space-y-2 border-t border-lime-900/40 pt-3">
        <h4 className="text-xs font-medium text-zinc-400">
          Aplicados neste clipe ({applied.length})
        </h4>
        {applied.length === 0 ? (
          <p className="text-xs text-zinc-500">Nenhum efeito aplicado.</p>
        ) : (
          <ul className="space-y-1.5">
            {applied.map((inst) => (
              <li
                key={inst.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0 text-zinc-300">
                  <span className="text-zinc-500">
                    [{typeLabel(inst.type)}]
                  </span>{" "}
                  <span className="font-medium text-zinc-100">
                    {inst.libraryItem?.name ?? inst.effectLibraryItemId.slice(0, 8)}
                  </span>
                  <span className="text-zinc-500">
                    {" "}
                    · {formatTime(inst.clipTimestamp ?? 0)} ·{" "}
                    {formatTime(inst.sourceTrimStart ?? 0)}–
                    {formatTime(inst.sourceTrimEnd ?? 0)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => void onRemove(inst.id)}
                  className="rounded border border-red-900/80 px-2 py-0.5 text-red-300 hover:border-red-600 disabled:opacity-50"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
