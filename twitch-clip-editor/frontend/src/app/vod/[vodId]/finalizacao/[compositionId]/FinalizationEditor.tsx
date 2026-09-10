"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  compositionJoinPreview,
  compositionUnifiedPreview,
  exportUnifiedComposition,
  fetchSegmentCompositionUsage,
  mediaUrl,
  reorderComposition,
  saveCompositionColorSettings,
  saveCompositionJoinSettings,
  saveCompositionOpeningSettings,
  saveCompositionClosingSettings,
  saveCompositionSubtitleSettings,
  trimClipSegmentInterval,
  type ClipSegment,
  type ClipTranscript,
  type CompositionWithSegments,
  type QualityId,
  type UnifiedExportSegmentInput,
} from "../../../../../lib/api";
import type { CompositionColorSettings } from "../../../../../lib/compositionColorSettings";
import type { CompositionJoinSettings } from "../../../../../lib/compositionJoinSettings";
import type { CompositionOpeningSettings } from "../../../../../lib/compositionOpeningSettings";
import type { CompositionClosingSettings } from "../../../../../lib/compositionClosingSettings";
import {
  computeCompositionDuration,
  formatDurationIndicator,
} from "../../../../../lib/compositionDuration";
import {
  hookDurationSec,
  isHookActive,
  normalizeHookRange,
} from "../../../../../lib/compositionOpeningSettings";
import type { SubtitleSettings } from "../../../../../lib/animatedSubtitle";
import type { CompositionSegmentSubtitleInput } from "../../../../../lib/compositionSubtitleRemap";
import {
  formatClipTime,
} from "../../../../../lib/finalizationTime";
import {
  CompositionPlayer,
  INITIAL_FAITHFUL_PREVIEW,
  type FaithfulPreviewState,
} from "./components/CompositionPlayer";
import {
  FinishTabs,
  parseCompositionColorSettingsFromJson,
  parseCompositionJoinSettingsFromJson,
  parseCompositionOpeningSettingsFromJson,
  parseCompositionClosingSettingsFromJson,
  parseSubtitleSettings,
  type FinishTabId,
} from "./components/FinishTabs";
import {
  SequenceTimeline,
  type CompositionSegmentView,
} from "./components/SequenceTimeline";
import { SubtitleTrack, wordsFromTranscriptSegments } from "./components/SubtitleTrack";

const LAYOUT_PRESET = "vertical-split-9x16";
const MAX_TRIM_UNDO = 24;

type TrimUndoEntry = {
  segmentId: string;
  sourceStart: number;
  sourceEnd: number;
};

type Props = {
  vodId: string;
  composition: CompositionWithSegments;
  onCompositionChange: (comp: CompositionWithSegments) => void;
};

function segmentDuration(cs: ClipSegment): number {
  return Math.max(0.1, cs.sourceEnd - cs.sourceStart);
}

function buildSegmentViews(
  composition: CompositionWithSegments
): CompositionSegmentView[] {
  const sorted = [...composition.segments].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );
  let timelineStart = 0;
  return sorted.map((s) => {
    const dur = segmentDuration(s.clipSegment);
    const view: CompositionSegmentView = {
      orderIndex: s.orderIndex,
      clipSegment: s.clipSegment,
      durationSec: dur,
      timelineStart,
    };
    timelineStart += dur;
    return view;
  });
}

function buildExportSegments(
  views: CompositionSegmentView[]
): UnifiedExportSegmentInput[] {
  return views.map((v) => ({
    clipSegmentId: v.clipSegment.id,
    presetApplications: Array.isArray(v.clipSegment.presetApplicationsJson)
      ? (v.clipSegment.presetApplicationsJson as unknown[])
      : undefined,
  }));
}

export function FinalizationEditor({
  vodId,
  composition,
  onCompositionChange,
}: Props) {
  const [draftInterval, setDraftInterval] = useState<{
    segmentId: string;
    sourceStart: number;
    sourceEnd: number;
  } | null>(null);

  const segmentViews = useMemo(() => {
    const base = buildSegmentViews(composition);
    if (!draftInterval) return base;
    let timelineStart = 0;
    return base.map((v) => {
      const cs = v.clipSegment;
      const start =
        draftInterval.segmentId === cs.id
          ? draftInterval.sourceStart
          : cs.sourceStart;
      const end =
        draftInterval.segmentId === cs.id
          ? draftInterval.sourceEnd
          : cs.sourceEnd;
      const dur = Math.max(0.1, end - start);
      const view: CompositionSegmentView = {
        ...v,
        clipSegment:
          draftInterval.segmentId === cs.id
            ? { ...cs, sourceStart: start, sourceEnd: end }
            : cs,
        durationSec: dur,
        timelineStart,
      };
      timelineStart += dur;
      return view;
    });
  }, [composition, draftInterval]);
  const [transcripts, setTranscripts] = useState<
    Record<string, ClipTranscript | null>
  >({});
  const [playheadTime, setPlayheadTime] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [faithfulPreview, setFaithfulPreview] =
    useState<FaithfulPreviewState>(INITIAL_FAITHFUL_PREVIEW);
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(() =>
    parseSubtitleSettings(composition.subtitleSettingsJson)
  );
  const [joinSettings, setJoinSettings] = useState<CompositionJoinSettings>(() =>
    parseCompositionJoinSettingsFromJson(composition.joinSettingsJson)
  );
  const [colorSettings, setColorSettings] = useState<CompositionColorSettings>(() =>
    parseCompositionColorSettingsFromJson(composition.colorSettingsJson)
  );
  const [openingSettings, setOpeningSettings] = useState<CompositionOpeningSettings>(() =>
    parseCompositionOpeningSettingsFromJson(composition.openingSettingsJson)
  );
  const [closingSettings, setClosingSettings] = useState<CompositionClosingSettings>(() =>
    parseCompositionClosingSettingsFromJson(composition.closingSettingsJson)
  );
  const [hookMarkingActive, setHookMarkingActive] = useState(false);
  const [hookSelectDraft, setHookSelectDraft] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<FinishTabId>("legendas");
  const [joinPreviewLoading, setJoinPreviewLoading] = useState<number | null>(
    null
  );
  const joinPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [quality, setQuality] = useState<QualityId>("hd");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [trackWidthPx, setTrackWidthPx] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const faithfulVideoRef = useRef<HTMLVideoElement>(null);
  const trimUndoRef = useRef<TrimUndoEntry[]>([]);
  const timelineTrackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = timelineTrackRef.current;
    if (!el) return;
    const update = () => setTrackWidthPx(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const segments = composition.segments.map((s) => s.clipSegment);
    (async () => {
      const entries = await Promise.all(
        segments.map(async (seg) => {
          const path = seg.clipTranscriptRelativePath;
          if (!path) return [seg.id, null] as const;
          try {
            const res = await fetch(apiUrl(`/media/${vodId}/${path}`), {
              cache: "no-store",
            });
            if (!res.ok) return [seg.id, null] as const;
            const data = (await res.json()) as ClipTranscript;
            return [seg.id, data] as const;
          } catch {
            return [seg.id, null] as const;
          }
        })
      );
      if (!cancelled) {
        const map: Record<string, ClipTranscript | null> = {};
        for (const [id, t] of entries) map[id] = t;
        setTranscripts(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composition.segments, vodId]);

  const totalDuration = useMemo(
    () => segmentViews.reduce((s, v) => s + v.durationSec, 0),
    [segmentViews]
  );

  const durationBreakdown = useMemo(
    () =>
      computeCompositionDuration({
        contentSec: totalDuration,
        openingSettings,
        closingSettings,
      }),
    [totalDuration, openingSettings, closingSettings]
  );

  const hookDisplaySec = hookDurationSec(openingSettings);

  const joinTimes = useMemo(() => {
    const times: number[] = [];
    let acc = 0;
    for (let i = 0; i < segmentViews.length - 1; i++) {
      acc += segmentViews[i].durationSec;
      times.push(Number(acc.toFixed(3)));
    }
    return times;
  }, [segmentViews]);

  const segmentSubtitleInputs = useMemo((): CompositionSegmentSubtitleInput[] => {
    return segmentViews.map((v) => {
      const t = transcripts[v.clipSegment.id];
      const words = t ? wordsFromTranscriptSegments(t.segments) : [];
      const dur = v.durationSec;
      return { finalStart: 0, finalEnd: dur, words };
    });
  }, [segmentViews, transcripts]);

  const activeSegmentId =
    segmentViews[activeSegmentIndex]?.clipSegment.id ?? null;

  const invalidateFaithful = useCallback(() => {
    setFaithfulPreview((prev) => {
      if (prev.mode === "fast" && !prev.url && !prev.loading) return prev;
      return { ...INITIAL_FAITHFUL_PREVIEW, mode: "fast" };
    });
  }, []);

  useEffect(() => {
    invalidateFaithful();
  }, [
    composition.segments,
    totalDuration,
    subtitleSettings,
    joinSettings,
    colorSettings,
    openingSettings,
    closingSettings,
    invalidateFaithful,
  ]);

  const renderPayload = useMemo(
    () => ({
      segments: buildExportSegments(segmentViews),
      joinSettings,
      colorSettings,
      openingSettings,
      closingSettings,
      subtitleSettings,
      segmentSubtitleInputs,
    }),
    [segmentViews, joinSettings, colorSettings, openingSettings, closingSettings, subtitleSettings, segmentSubtitleInputs]
  );

  const segmentVideoSrc = useCallback(
    (seg: CompositionSegmentView): string | null => {
      const cs = seg.clipSegment;
      if (cs.previewRelativePath) {
        return mediaUrl(vodId, cs.previewRelativePath);
      }
      if (cs.exportRelativePath) {
        return mediaUrl(vodId, cs.exportRelativePath);
      }
      return mediaUrl(vodId, "source.mp4");
    },
    [vodId]
  );

  const handleSeek = useCallback(
    (time: number) => {
      const t = Math.max(0, Math.min(totalDuration, time));
      setPlayheadTime(t);
      let acc = 0;
      for (let i = 0; i < segmentViews.length; i++) {
        const dur = segmentViews[i].durationSec;
        if (t < acc + dur || i === segmentViews.length - 1) {
          setActiveSegmentIndex(i);
          break;
        }
        acc += dur;
      }
    },
    [segmentViews, totalDuration]
  );

  const handleReorder = useCallback(
    async (clipSegmentIds: string[]) => {
      setBusy(true);
      setError("");
      try {
        const comp = await reorderComposition(composition.id, clipSegmentIds);
        onCompositionChange(comp);
        invalidateFaithful();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [composition.id, invalidateFaithful, onCompositionChange]
  );

  const handleBeforeTrim = useCallback(async (segmentId: string) => {
    try {
      const count = await fetchSegmentCompositionUsage(segmentId);
      if (count > 1) {
        return window.confirm(
          `Este trecho é usado em ${count} composições.\n\nCortar aqui altera o trecho original em todas elas.\n\nContinuar?`
        );
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  const handleTrimCommit = useCallback(
    async (segmentId: string, sourceStart: number, sourceEnd: number) => {
      setBusy(true);
      setError("");
      try {
        const updated = await trimClipSegmentInterval(
          segmentId,
          sourceStart,
          sourceEnd
        );
        const nextSegments = composition.segments.map((s) =>
          s.clipSegment.id === segmentId
            ? { ...s, clipSegment: updated }
            : s
        );
        onCompositionChange({ ...composition, segments: nextSegments });
        invalidateFaithful();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [composition, invalidateFaithful, onCompositionChange]
  );

  const handleTrimUndoPush = useCallback(
    (segmentId: string, sourceStart: number, sourceEnd: number) => {
      const stack = trimUndoRef.current;
      stack.push({ segmentId, sourceStart, sourceEnd });
      if (stack.length > MAX_TRIM_UNDO) stack.shift();
    },
    []
  );

  const handleTrimUndo = useCallback(async () => {
    const entry = trimUndoRef.current.pop();
    if (!entry) return;
    setBusy(true);
    try {
      const updated = await trimClipSegmentInterval(
        entry.segmentId,
        entry.sourceStart,
        entry.sourceEnd
      );
      const nextSegments = composition.segments.map((s) =>
        s.clipSegment.id === entry.segmentId
          ? { ...s, clipSegment: updated }
          : s
      );
      onCompositionChange({ ...composition, segments: nextSegments });
      invalidateFaithful();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [composition, invalidateFaithful, onCompositionChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        void handleTrimUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleTrimUndo]);

  const handleSubtitleSettingsChange = useCallback(
    async (settings: SubtitleSettings) => {
      setSubtitleSettings(settings);
      invalidateFaithful();
      try {
        await saveCompositionSubtitleSettings(composition.id, settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composition.id, invalidateFaithful]
  );

  const handleJoinSettingsChange = useCallback(
    async (settings: CompositionJoinSettings) => {
      setJoinSettings(settings);
      invalidateFaithful();
      try {
        await saveCompositionJoinSettings(composition.id, settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composition.id, invalidateFaithful]
  );

  const handleColorSettingsChange = useCallback(
    async (settings: CompositionColorSettings) => {
      setColorSettings(settings);
      invalidateFaithful();
      try {
        await saveCompositionColorSettings(composition.id, settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composition.id, invalidateFaithful]
  );

  const handleOpeningSettingsChange = useCallback(
    async (settings: CompositionOpeningSettings) => {
      setOpeningSettings(settings);
      invalidateFaithful();
      try {
        await saveCompositionOpeningSettings(composition.id, settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composition.id, invalidateFaithful]
  );

  const handleClosingSettingsChange = useCallback(
    async (settings: CompositionClosingSettings) => {
      setClosingSettings(settings);
      invalidateFaithful();
      try {
        await saveCompositionClosingSettings(composition.id, settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [composition.id, invalidateFaithful]
  );

  const handleHookRangeCommit = useCallback(
    (startSec: number, endSec: number) => {
      const draft: CompositionOpeningSettings = {
        ...openingSettings,
        mode: "hook",
        hookEnabled: true,
        hookStartSec: startSec,
        hookEndSec: endSec,
      };
      const { settings, warnings } = normalizeHookRange(draft, totalDuration);
      if (warnings.length > 0) {
        setStatus(warnings[0]);
      }
      void handleOpeningSettingsChange(settings);
      setHookMarkingActive(false);
    },
    [handleOpeningSettingsChange, openingSettings, totalDuration]
  );

  const handleTrimLastSegment = useCallback(
    async (trimSec: number) => {
      const last = segmentViews[segmentViews.length - 1];
      if (!last) return;
      const cs = last.clipSegment;
      const newEnd = Math.max(
        cs.sourceStart + 0.5,
        cs.sourceEnd - trimSec
      );
      const ok = await handleBeforeTrim(cs.id);
      if (!ok) return;
      handleTrimUndoPush(cs.id, cs.sourceStart, cs.sourceEnd);
      await handleTrimCommit(cs.id, cs.sourceStart, newEnd);
    },
    [handleBeforeTrim, handleTrimCommit, handleTrimUndoPush, segmentViews]
  );

  const handleJoinPreview = useCallback(
    async (joinIndex: number) => {
      setJoinPreviewLoading(joinIndex);
      setError("");
      try {
        const result = await compositionJoinPreview({
          vodId,
          preset: LAYOUT_PRESET,
          joinIndex,
          ...renderPayload,
        });
        const url = mediaUrl(vodId, result.previewUrlPath);
        if (joinPreviewAudioRef.current) {
          joinPreviewAudioRef.current.pause();
        }
        const audio = new Audio(url);
        joinPreviewAudioRef.current = audio;
        await audio.play();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setJoinPreviewLoading(null);
      }
    },
    [renderPayload, vodId]
  );

  const handleRequestFaithfulRender = useCallback(async () => {
    if (segmentViews.length === 0) return;
    const windowStart = Math.max(0, playheadTime - 2);
    const windowEnd = Math.min(totalDuration, playheadTime + 8);
    setFaithfulPreview((prev) => ({ ...prev, loading: true }));
    try {
      const result = await compositionUnifiedPreview({
        vodId,
        preset: LAYOUT_PRESET,
        windowStart,
        windowEnd,
        ...renderPayload,
      });
      setFaithfulPreview({
        mode: "faithful",
        url: result.previewUrlPath,
        windowStart,
        windowEnd,
        cached: result.cached,
        loading: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFaithfulPreview((prev) => ({ ...prev, loading: false }));
    }
  }, [playheadTime, renderPayload, totalDuration, vodId]);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError("");
    setStatus("Exportando…");
    try {
      const result = await exportUnifiedComposition({
        vodId,
        quality,
        preset: LAYOUT_PRESET,
        burnSubtitles: true,
        ...renderPayload,
      });
      const warnings =
        result.joinWarnings && result.joinWarnings.length > 0
          ? ` · avisos: ${result.joinWarnings.join(" ")}`
          : "";
      setStatus(
        `Export ok · ${formatClipTime(result.totalDurationSec)} · ${result.prontosRelativePath}${warnings}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, [quality, renderPayload, vodId]);

  const warnLevel = durationBreakdown.warnLevel;

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col">
      <div className="flex flex-1 gap-4 p-4">
        <CompositionPlayer
          vodId={vodId}
          segments={segmentViews}
          playheadTime={playheadTime}
          activeSegmentIndex={activeSegmentIndex}
          onPlayheadChange={setPlayheadTime}
          onActiveSegmentChange={setActiveSegmentIndex}
          videoRef={videoRef}
          faithfulVideoRef={faithfulVideoRef}
          faithfulPreview={faithfulPreview}
          onRequestFaithfulRender={handleRequestFaithfulRender}
          segmentVideoSrc={segmentVideoSrc}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">
                {composition.name || "Composição"}
              </h2>
              <p
                className={`text-sm font-mono ${
                  warnLevel === "strong"
                    ? "text-red-300"
                    : warnLevel === "soft"
                      ? "text-amber-300"
                      : "text-zinc-400"
                }`}
              >
                {formatDurationIndicator(durationBreakdown)}
                {warnLevel === "soft" && " · acima de 22s"}
                {warnLevel === "strong" && " · acima de 30s"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-zinc-400">
                qualidade
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as QualityId)}
                  className="ml-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1"
                >
                  <option value="draft">draft</option>
                  <option value="hd">hd</option>
                  <option value="max">max</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy || segmentViews.length === 0}
                onClick={handleExport}
                className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-medium hover:bg-fuchsia-600 disabled:opacity-50"
              >
                {busy ? "…" : "exportar"}
              </button>
            </div>
          </div>

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

          <FinishTabs
            vodId={vodId}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            subtitleSettings={subtitleSettings}
            onSubtitleSettingsChange={handleSubtitleSettingsChange}
            joinSettings={joinSettings}
            onJoinSettingsChange={handleJoinSettingsChange}
            colorSettings={colorSettings}
            onColorSettingsChange={handleColorSettingsChange}
            openingSettings={openingSettings}
            onOpeningSettingsChange={handleOpeningSettingsChange}
            closingSettings={closingSettings}
            onClosingSettingsChange={handleClosingSettingsChange}
            segmentInputs={segmentSubtitleInputs}
            joinTimes={joinTimes}
            segments={segmentViews}
            segmentViews={segmentViews}
            contentDuration={totalDuration}
            segmentVideoSrc={segmentVideoSrc}
            onReorder={handleReorder}
            hookMarkingActive={hookMarkingActive}
            onHookMarkingActiveChange={setHookMarkingActive}
            loopEnabled={loopEnabled}
            onLoopEnabledChange={setLoopEnabled}
            onTrimLastSegment={handleTrimLastSegment}
            onJoinPreview={handleJoinPreview}
            joinPreviewLoading={joinPreviewLoading}
          />
        </div>
      </div>

      <div className="border-t border-zinc-800 p-4" ref={timelineTrackRef}>
        <SequenceTimeline
          segments={segmentViews}
          totalDuration={totalDuration}
          playheadTime={playheadTime}
          activeSegmentId={activeSegmentId}
          draftInterval={draftInterval}
          onSeek={handleSeek}
          onReorder={handleReorder}
          onTrimCommit={handleTrimCommit}
          onTrimDraft={setDraftInterval}
          onTrimUndoPush={handleTrimUndoPush}
          onBeforeTrim={handleBeforeTrim}
          hookDisplaySec={isHookActive(openingSettings) ? hookDisplaySec : 0}
          hookSourceStart={openingSettings.hookStartSec}
          hookSourceEnd={openingSettings.hookEndSec}
          hookMarkingActive={hookMarkingActive}
          onHookRangeCommit={handleHookRangeCommit}
          hookSelectDraft={hookSelectDraft}
          onHookSelectDraft={setHookSelectDraft}
        />
        <div className="mt-2">
          <SubtitleTrack
            totalDuration={totalDuration}
            trackWidthPx={trackWidthPx}
            segmentInputs={segmentSubtitleInputs}
            joinTimes={joinTimes}
          />
        </div>
      </div>
    </div>
  );
}
